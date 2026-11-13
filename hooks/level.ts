import type { EngineInterface } from 'claude-code'

type Api = EngineInterface

// XP needed to reach Lv1, Lv2, Lv3 and Lv4 (bow tie, this month's hat, golden body); tune here.
export const LEVELS = [0, 200, 900, 2500]
export const MAX_LEVEL = LEVELS.length
export const levelOf = (xp: number) => LEVELS.filter(t => xp >= t).length

export type Src = 'turn' | 'firstTurn' | 'commit' | 'firstCommit' | 'pr' | 'green' | 'thanks' | 'back'
// xp per award; cap is per day over all sessions; float shows a "+N" beside the buddy.
export const RULES: Record<Src, { xp: number; cap?: number; float?: boolean }> = {
  turn: { xp: 1, cap: 40 },
  firstTurn: { xp: 10, cap: 1 },
  commit: { xp: 5, cap: 10, float: true },
  firstCommit: { xp: 10, cap: 1, float: true },
  pr: { xp: 20, float: true },
  green: { xp: 3, cap: 3, float: true },
  thanks: { xp: 2, cap: 5 },
  back: { xp: 2, cap: 5 },
}

// Persisted in $.store: one `xp:<YYYY-MM>:<session id>` key per session and month, so two processes never overwrite
// each other. It holds the session's XP and the per-source counters of one day (the latest it earned on); the month
// total is the sum over the month's keys and a day's cap is checked against the sum of today's counters.
// `goldenMonths` lists the finished months that reached the top level.
const XP_PREFIX = 'xp:'
const GOLDEN_KEY = 'goldenMonths'

type XpRec = { day: string; n: Partial<Record<Src, number>>; xp: number }
export type XpState = { month: string; total: number; today: Partial<Record<Src, number>>; golden: string[] }

const isRec = (x: unknown): x is XpRec =>
  !!x && typeof x === 'object' && typeof (x as XpRec).day === 'string' && Number.isFinite((x as XpRec).xp) && !!(x as XpRec).n && typeof (x as XpRec).n === 'object'

const pad = (n: number) => String(n).padStart(2, '0')
export const monthKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
export const dayKey = (ms: number) => `${monthKey(ms)}-${pad(new Date(ms).getDate())}`

// The reading is cached here; it refreshes on session.start, every award and a month change, and a render reuses it
// for XP_TTL_MS.
let xp: (XpState & { at: number }) | null = null
export const xpState = () => xp
export const XP_TTL_MS = 5000

// Bumped by every award; a read that started before an award must not store its (possibly lower) result.
let gen = 0

// Sums this month's keys and rolls the older months over (no scheduled job): a finished month that reached the top
// level joins the golden record, and its keys go.
export async function refreshXp($: Api, at?: number): Promise<XpState> {
  const now = at ?? (await $.clock.now())
  const month = monthKey(now)
  const day = dayKey(now)
  const started = gen
  const keys = (await $.store.keys()).filter(k => k.startsWith(XP_PREFIX))
  // Every key is read again: a session resumed on a later day rewrites its own key, so no record is safe to keep.
  const recs = await Promise.all(keys.map(k => $.store.get(k)))
  let total = 0
  const today: XpState['today'] = {}
  const past = new Map<string, number>()
  const stale: string[] = []
  keys.forEach((k, i) => {
    const m = k.slice(XP_PREFIX.length, XP_PREFIX.length + 7)
    const rec = recs[i]
    if (!isRec(rec)) return
    if (m === month) {
      total += rec.xp
      if (rec.day === day) for (const [s, c] of Object.entries(rec.n)) today[s as Src] = (today[s as Src] ?? 0) + (c ?? 0)
    } else if (m < month) {
      past.set(m, (past.get(m) ?? 0) + rec.xp)
      stale.push(k)
    }
  })
  const raw = await $.store.get(GOLDEN_KEY)
  let golden = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  if (stale.length) {
    const won = [...past].filter(([, t]) => t >= LEVELS[MAX_LEVEL - 1]!).map(([m]) => m)
    const next = [...new Set([...golden, ...won])].sort()
    if (next.length !== golden.length) await $.store.set(GOLDEN_KEY, next)
    golden = next
    for (const k of stale) await $.store.delete(k)
  }
  const st = { month, total, today, golden, at: now }
  if (gen === started) xp = st
  return st
}

// The cached reading for a render: read again only when it is older than XP_TTL_MS or from another month, one read at
// a time, and a failed read is not retried within the window either. Null while there is no reading at all.
let reading: Promise<unknown> | null = null
let triedAt = -Infinity
export async function freshXp($: Api, now: number): Promise<XpState | null> {
  if (!xp || xp.month !== monthKey(now) || (now - xp.at >= XP_TTL_MS && now - triedAt >= XP_TTL_MS)) {
    if (!reading) {
      triedAt = now
      reading = refreshXp($, now)
        .catch(() => undefined)
        .finally(() => (reading = null))
    }
    await reading
  }
  return xp
}

// Awards are serialized in this process; a race between processes may overshoot a cap by a little.
let queue: Promise<unknown> = Promise.resolve()
export function award($: Api, srcs: Src[]): Promise<{ gained: number; shown: number }> {
  const run = queue.then(() => doAward($, srcs))
  queue = run.catch(() => undefined)
  return run
}

async function doAward($: Api, srcs: Src[]) {
  const now = await $.clock.now()
  const st = await refreshXp($, now)
  const day = dayKey(now)
  const key = `${XP_PREFIX}${st.month}:${await $.session.id()}`
  const raw = await $.store.get(key)
  const rec: XpRec = isRec(raw) ? (raw.day === day ? raw : { ...raw, day, n: {} }) : { day, n: {}, xp: 0 }
  let gained = 0
  let shown = 0
  for (const s of srcs) {
    const r = RULES[s]
    const used = st.today[s] ?? 0
    if (r.cap !== undefined && used >= r.cap) continue
    st.today[s] = used + 1
    rec.n[s] = (rec.n[s] ?? 0) + 1
    rec.xp += r.xp
    gained += r.xp
    if (r.float) shown += r.xp
  }
  if (gained > 0) {
    await $.store.set(key, rec)
    st.total += gained
    gen++
    if (xp && xp.month === st.month) xp = { ...xp, total: st.total, today: st.today }
  }
  return { gained, shown }
}

const withSep = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const xpLine = (total: number) => {
  const lv = levelOf(total)
  return lv >= MAX_LEVEL ? `Lv ${lv} · ${withSep(total)} XP ✨` : `Lv ${lv} · ${withSep(total)} / ${withSep(LEVELS[lv]!)} XP`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const goldenLine = (golden: string[]) =>
  golden.length === 0 ? '' : `✨ ${golden.map(m => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`).join(', ')}`

// ---- detection, on the command text of a Bash call (several commands may be chained in one)
const CMD = String.raw`(?:^|[\s;&|(])`
const GIT_COMMIT = new RegExp(`${CMD}git\\s+(?:(?:-[Cc]\\s+\\S+|--?[\\w-]+(?:=\\S+)?)\\s+)*commit(?:\\s|$)`)
// Quoted strings are blanked, so a flag or word inside a message or title is not read as an argument.
const unquoted = (cmd: string) => cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
export const isCommit = (cmd: string) => {
  const c = unquoted(cmd)
  const m = GIT_COMMIT.exec(c)
  if (!m) return false
  const seg = c.slice(m.index).replace(/^[\s;&|(]/, '').split(/;|&&|\|\||\||&|\n/)[0]!
  return !/(?:^|\s)--amend(?:[\s=]|$)/.test(seg)
}
// `[branch abc1234] message`, git's own line after a commit
export const commitOutput = (text: string | undefined) => text === undefined || /\[[^\]\n]+ [0-9a-f]{7,}\]/.test(text)
// A pull request is only made when `gh pr create` ran for real: no --help, --web or --dry-run among its arguments.
const PR_CREATE = new RegExp(`${CMD}gh\\s+pr\\s+create(?=\\s|$)([^;&|\\n]*)`)
export const isPrCreate = (cmd: string) => {
  const m = PR_CREATE.exec(unquoted(cmd))
  return !!m && !/(?:^|\s)(?:--help|-h|--web|-w|--dry-run)(?:[\s=]|$)/.test(m[1]!.replace(/(?:^|\s)#.*/, ''))
}
// gh prints the new pull request's URL
export const prOutput = (text: string | undefined) => text === undefined || /\/pull\/\d+/.test(text)
const TEST_CMD = new RegExp(
  `${CMD}(?:(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?test|pytest|go\\s+test|cargo\\s+test|claude\\s+plugin\\s+test)(?:\\s|$)`,
)
export const isTestCmd = (cmd: string) => TEST_CMD.test(cmd)

const THANKS = /\b(?:thanks|thank\s+(?:you|u)|thx|ty|merci|gracias|danke|arigat(?:o|ou)|obrigad[oa])\b/i
const THANKS_WIDE = /cảm ơn|cám ơn|谢谢|謝謝|ありがとう/i
export const isThanks = (text: string) => THANKS.test(text) || THANKS_WIDE.test(text)
