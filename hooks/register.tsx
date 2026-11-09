import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { BuddyCache, BuddyLimit, BuddyState, BuddyUsage, BuddyView } from '../types'
import { EMOJI, LABELS, buddySvg } from './art'

type Api = EngineInterface

const view = atom({ plugin: 'my-buddy', key: 'view' } as const, { main: 'idle', subs: [], demo: false } as BuddyView, {
  shape: 'view-2',
})

const usage = atom({ plugin: 'my-buddy', key: 'usage' } as const, null as BuddyUsage | null, { shape: 'usage-2' })

// When the main thread's prompt cache was last refreshed, and how long one refresh holds it.
const cache = atom({ plugin: 'my-buddy', key: 'cache' } as const, null as BuddyCache | null, { shape: 'cache-1' })

const MIN_DWELL_MS = 700
const DONE_TO_IDLE_MS = 5000
const STALE_SUB_MS = 600_000 // a rescue for lost SubagentStop/turn.complete events, so longer than any one tool call
const HELPERS_TICK_MS = 60_000
const CACHE_TICK_MS = 5000
const CACHE_WARN_MS = 60_000
const CACHE_COARSE_TICK_MS = 60_000
const CACHE_FINE_MS = 600_000 // the last stretch, redrawn every CACHE_TICK_MS
const DEFAULT_TTL_MIN = 60
const MAX_SUBS = 8
const PANE = 'my-buddy'
const MAIN_PX = 96
const SUB_PX = 52
const BAND_MAIN_PX = 64
const BAND_SUB_PX = 36
const DEMO_STEP_MS = 2500
const DEMO_STATES: BuddyState[] = [
  'idle', 'thinking', 'reading', 'searching', 'editing', 'running', 'browsing',
  'spawning', 'waiting', 'error', 'done', 'compacting', 'working',
]

const stateForTool = (tool: string, e?: unknown): BuddyState => {
  if (tool.startsWith('mcp__') && /browser|chrome|playwright|puppeteer/i.test(tool)) return 'browsing'
  switch (tool) {
    case 'Read': case 'LSP': case 'Skill': return 'reading'
    case 'Grep': case 'Glob': case 'ToolSearch': return 'searching'
    case 'Edit': case 'Write': case 'NotebookEdit': return 'editing'
    case 'Bash': {
      const c = (e as { command?: unknown } | undefined)?.command
      return typeof c === 'string' ? bashState(c) : 'running'
    }
    case 'Monitor': return 'running'
    case 'WebSearch': case 'WebFetch': return 'browsing'
    case 'Agent': case 'Task': case 'Workflow': return 'spawning'
    case 'AskUserQuestion': return 'waiting'
    default: return 'working'
  }
}

const fmtTokens = (n: number) => {
  if (n < 1000) return String(Math.round(n))
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

// Graded by absolute tokens, like the statusline.
const tokenColor = (n: number) => (n < 50_000 ? 'green' : n < 100_000 ? 'yellow' : n < 150_000 ? 'red' : 'magenta')
const limitColor = (p: number) => (p < 70 ? 'green' : p < 90 ? 'yellow' : 'red')

type Tone = 'green' | 'yellow' | 'red' | 'magenta'
// Mid-tones that read on light and dark.
const HEX: Record<Tone, string> = { green: '#639922', yellow: '#BA7517', red: '#E24B4A', magenta: '#D4537E' }
const TRACK = '#88878055'
const BAR_W = 140
const BAR_H = 6
const BAR_CELLS = 10
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

const clockTime = (d: Date) => {
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// Absolute local time, so it never goes stale between turns; the weekday only for a far-off 7-day reset
// ("next Thu" when that is today's weekday, so it can't read as today).
const resetText = (iso: string | undefined, now: number, weekday: boolean) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const far = weekday && d.getTime() - now > DAY_MS
  const day = DAYS[d.getDay()]!
  return ` · resets ${far ? (d.getDay() === new Date(now).getDay() ? `next ${day}` : day) : clockTime(d)}`
}

const NARROW_COLUMNS = 60

type Meter = { label: string; pct: number; tone: Tone; text: string }

const meters = (u: BuddyUsage | null, now: number, narrow: boolean): Meter[] => {
  if (!u) return []
  const out: Meter[] = []
  const tokens = u.tokens
  if (tokens !== undefined) {
    const pct = u.percent ?? (u.window > 0 ? (tokens / u.window) * 100 : undefined)
    out.push({
      label: 'ctx',
      pct: pct ?? 0,
      tone: tokenColor(tokens),
      text: `${fmtTokens(tokens)}${pct === undefined ? '' : ` · ${Math.round(pct)}%`}`,
    })
  }
  for (const l of u.limits ?? []) {
    const five = l.kind === 'five_hour'
    out.push({
      label: five ? '5h' : '7d',
      pct: l.percentUsed,
      tone: limitColor(l.percentUsed),
      text: `${Math.round(l.percentUsed)}%${narrow ? '' : resetText(l.resetsAt, now, !five)}`,
    })
  }
  return out
}

const clampPct = (p: number) => (Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0)

const barSvg = (pct: number, tone: Tone) => {
  const w = clampPct(pct) > 0 ? Math.max(BAR_H, (BAR_W * clampPct(pct)) / 100) : 0
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_W} ${BAR_H}" width="${BAR_W}" height="${BAR_H}" style="background:transparent">` +
    `<rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${TRACK}"/>` +
    (w > 0 ? `<rect width="${w.toFixed(1)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${HEX[tone]}"/>` : '') +
    '</svg>'
  )
}

// Eighth-block resolution: [lit, unlit].
const PARTIALS = ' ▏▎▍▌▋▊▉'
const blockBar = (pct: number): [string, string] => {
  const eighths = Math.round((clampPct(pct) / 100) * BAR_CELLS * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  return ['█'.repeat(full) + (part ? PARTIALS[part] : ''), '▏'.repeat(BAR_CELLS - full - (part ? 1 : 0))]
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

const CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&"']+)\s*(?:&&|;)\s*/
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec'])
// Program name only, never arguments, so secrets cannot leak.
const bashParse = (command: string): { prog: string; args: string[] } => {
  const none = { prog: '', args: [] }
  let c = command.split('\n')[0]!
  for (let prev = ''; prev !== c; ) {
    prev = c
    c = c.replace(CD_PREFIX, '')
  }
  // Bash splits on space and tab only; any other whitespace could split a value we'd misread.
  if (/[^\S \t]/.test(c)) return none
  const words = squash(c).split(' ')
  let i = 0
  while (i < words.length && (words[i]!.includes('=') || WRAPPERS.has(words[i]!))) i++
  // Only plain NAME=value words may come before the program; a quote, escape, substitution or
  // control operator could hide a spaced value or start another command, so show nothing.
  if (!words.slice(0, i).every(w => WRAPPERS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=[^\s"'\\`$(){};&|<>]*$/.test(w))) return none
  const word = words[i] ?? ''
  // A path-like word only: URLs, userinfo and flags never get through.
  const prog = /^[A-Za-z0-9._+~/-]+$/.test(word) ? word.split('/').pop()! : ''
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,23}$/.test(prog) ? { prog, args: words.slice(i + 1) } : none
}
const bashDetail = (command: string) => bashParse(command).prog

const BASH_STATES: Record<string, BuddyState> = {}
const bashGroup = (st: BuddyState, progs: string) => progs.split(' ').forEach(p => (BASH_STATES[p] = st))
bashGroup('reading', 'cat head tail sed less more jq wc bat awk sort uniq diff xxd')
bashGroup('searching', 'grep egrep rg ag find fd ls tree locate which')
bashGroup('browsing', 'curl wget gh http')
const GIT_STATES: Record<string, BuddyState> = {
  status: 'searching', log: 'searching', grep: 'searching', 'ls-files': 'searching', branch: 'searching',
  diff: 'reading', show: 'reading', blame: 'reading',
}
// The state comes from the program (and the git subcommand), which are read but never displayed.
const bashState = (command: string): BuddyState => {
  const { prog, args } = bashParse(command)
  if (prog === 'git') {
    // -C <path> and -c <name=value> take a value before the subcommand.
    const sub = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-C' && args[i - 1] !== '-c')
    return GIT_STATES[sub ?? ''] ?? 'running'
  }
  return BASH_STATES[prog] ?? 'running'
}

// The desktop app's own housekeeping (task list, session, view, settings, ...): never the buddy's activity.
const HOUSEKEEPING = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'])
const isHousekeeping = (tool: string) => tool.startsWith('mcp__ccd_') || HOUSEKEEPING.has(tool)

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

// Tool args ride beside `tool` on the event; any shape we don't know yields no detail.
const detailFor = (tool: string, e: unknown): string | undefined => {
  const a = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  let d = ''
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': d = base(str('file_path')); break
    case 'NotebookEdit': d = base(str('notebook_path')); break
    case 'Bash': d = bashDetail(str('command')); break
    case 'Grep': d = squash(str('pattern')) && `"${trim(squash(str('pattern')), 20)}"`; break
    case 'Glob': d = trim(squash(str('pattern')), 24); break
    case 'WebFetch': d = hostOf(str('url')); break
    case 'WebSearch': d = trim(squash(str('query')), 24); break
    case 'Agent': case 'Task': d = trim(squash(str('description')), 28); break
  }
  return squash(d) || undefined
}

type CacheLine = { text: string; tone?: 'yellow' | 'red' }

// Null before any main response; the caller hides it while a main turn runs.
const cacheLine = (c: BuddyCache | null, now: number): CacheLine | null => {
  if (!c) return null
  const left = c.at + c.ttlMs - now
  if (left <= 0) return { text: 'cache cold', tone: 'red' }
  const secs = Math.floor(left / 1000)
  const text = left >= 600_000 ? `cache ${Math.floor(secs / 60)}m` : `cache ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  return left < CACHE_WARN_MS ? { text, tone: 'yellow' } : { text }
}

const labelOf = (v: BuddyView) => (v.detail ? `${LABELS[v.main]} ${v.detail}` : LABELS[v.main])

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

// Module-level timing only; what is drawn lives in the `view` atom.
let shown: BuddyState = 'idle'
let shownAt = 0
let pending: BuddyState | null = null
let pendingDetail: string | undefined
let pendTimer: Timer | null = null
let idleTimer: Timer | null = null
let isDemo = false
let inHelpers = false // main shows `working on N helpers` while background subs run; a reload resets it with the view
let helpersTick: Timer | null = null
let cacheTick: Timer | null = null
let cacheGen = 0 // bumped on every stop, so a callback of a cancelled tick cannot re-arm it
let cachePeriod = 0
let mainRunning = false // between the main turn.start and turn.complete: the cache line is hidden
let askedUser = false // the main turn put a question to the person: it ends in waiting, not done
const subTimers = new Map<string, Timer>()

const withDetail = (v: BuddyView, st: BuddyState, detail?: string): BuddyView => {
  const { detail: _old, ...rest } = v
  return { ...rest, main: st, ...(detail && { detail }) }
}

async function apply($: Api, st: BuddyState, detail?: string) {
  pendTimer?.cancel()
  pendTimer = null
  pending = null
  pendingDetail = undefined
  shown = st
  shownAt = await $.clock.now()
  await update($, view, v => withDetail(v, st, detail))
}

async function setMain($: Api, st: BuddyState, o: { demo?: boolean; fromTimer?: boolean; force?: boolean; detail?: string; helpers?: boolean } = {}) {
  if (isDemo && !o.demo) return
  inHelpers = o.helpers === true
  if (inHelpers) helpersTick ??= $.clock.every(HELPERS_TICK_MS, () => void rescueHelpers($))
  else {
    helpersTick?.cancel()
    helpersTick = null
  }
  if (!o.fromTimer) {
    idleTimer?.cancel()
    idleTimer = null
  }
  if (st === shown) {
    pendTimer?.cancel()
    pendTimer = null
    pending = null
    pendingDetail = undefined
    // Same state, new subject (Read a, then Read b): no flicker, so no dwell.
    await update($, view, v => (v.detail === o.detail ? v : withDetail(v, st, o.detail)))
    return
  }
  const wait = shownAt + MIN_DWELL_MS - (await $.clock.now())
  if (o.force || wait <= 0) return apply($, st, o.detail)
  pending = st
  pendingDetail = o.detail
  pendTimer ??= $.clock.after(wait, () => {
    pendTimer = null
    if (pending !== null) void apply($, pending, pendingDetail)
  })
}

async function setSub($: Api, id: string, st: BuddyState) {
  const now = await $.clock.now()
  await update($, view, v => {
    if (v.subs.some(s => s.id === id)) return { ...v, subs: v.subs.map(s => (s.id === id ? { ...s, state: st, seen: now } : s)) }
    let subs = v.subs
    if (subs.length >= MAX_SUBS) {
      // Make room by evicting a finished sub; if every sub is still running, keep them and skip the newcomer.
      const doneAt = subs.findIndex(s => s.state === 'done')
      if (doneAt < 0) return v
      subs = subs.filter((_, i) => i !== doneAt)
    }
    return { ...v, subs: [...subs, { id, state: st, seen: now }] }
  })
}


async function resetLeftovers($: Api) {
  isDemo = false
  inHelpers = false
  helpersTick?.cancel()
  helpersTick = null
  stopCacheTick()
  mainRunning = false
  shown = 'idle'
  shownAt = 0
  await update($, view, v => ({ ...withDetail(v, 'idle'), demo: false, subs: v.subs.filter(s => s.id !== 'demo-sub') }))
}

async function stampCache($: Api, at: number, ttlMs: number) {
  await update($, cache, () => ({ at, ttlMs }))
  await syncCacheTick($)
}

function stopCacheTick() {
  cacheGen++
  cacheTick?.cancel()
  cacheTick = null
  cachePeriod = 0
}

// /clear, /compact and /model start a cold cache: hide the line until the next response.
async function forgetCache($: Api) {
  stopCacheTick()
  await update($, cache, () => null)
  $.ui.invalidate('ui.render')
}

// Redraws while the cache is warm (every 5 s in the last 10 minutes, every minute before); stops once it is cold.
// Drawing hides the line during a turn, so ticks that fire then are harmless.
async function syncCacheTick($: Api) {
  const c = await read($, cache)
  const left = c ? c.at + c.ttlMs - (await $.clock.now()) : 0
  if (left <= 0) return stopCacheTick()
  const period = left > CACHE_FINE_MS ? CACHE_COARSE_TICK_MS : CACHE_TICK_MS
  if (cacheTick && cachePeriod === period) return
  cacheTick?.cancel()
  const gen = ++cacheGen
  cachePeriod = period
  cacheTick = $.clock.every(period, () => {
    if (gen !== cacheGen) return
    $.ui.invalidate('ui.render')
    void safe(() => syncCacheTick($))
  })
}

// Only the two windows the band shows, in a fixed order.
const limitsOf = (rl: unknown): BuddyLimit[] => {
  const list = Array.isArray(rl) ? (rl as Partial<BuddyLimit>[]) : []
  const out: BuddyLimit[] = []
  for (const kind of ['five_hour', 'seven_day'] as const) {
    const l = list.find(x => x?.kind === kind)
    if (l && typeof l.percentUsed === 'number' && Number.isFinite(l.percentUsed)) {
      out.push({ kind, percentUsed: l.percentUsed, ...(typeof l.resetsAt === 'string' && { resetsAt: l.resetsAt }) })
    }
  }
  return out
}

// Writes only when the reading changed.
async function setUsage($: Api, ctx: Omit<BuddyUsage, 'limits'> & { limits?: BuddyLimit[] }, rateLimits: unknown) {
  const next: BuddyUsage = {
    window: ctx.window,
    ...(ctx.tokens !== undefined && { tokens: ctx.tokens }),
    ...(ctx.percent !== undefined && { percent: ctx.percent }),
    limits: limitsOf(rateLimits),
  }
  await update($, usage, cur =>
    cur &&
    cur.tokens === next.tokens &&
    cur.window === next.window &&
    cur.percent === next.percent &&
    JSON.stringify(cur.limits) === JSON.stringify(next.limits)
      ? cur
      : next,
  )
}

// Re-reads the live reading; a tokens-less one drops the stored tokens.
// An auto-compaction mid-turn goes back to thinking, not idle; a /compact between turns goes idle.
async function afterCompact($: Api) {
  if (mainRunning) await setMain($, 'thinking')
  else await toIdle($)
}

async function seedUsage($: Api) {
  const live = await $.session.usage()
  await setUsage($, live.context, live.rateLimits)
}

// Drop subs that finished or went quiet, e.g. a drop timer lost to a hot reload.
async function pruneSubs($: Api) {
  const now = await $.clock.now()
  await update($, view, v => {
    const subs = v.subs.filter(s => s.state !== 'done' && now - s.seen <= STALE_SUB_MS)
    return subs.length === v.subs.length ? v : { ...v, subs }
  })
}

async function setDemo($: Api, on: boolean) {
  isDemo = on
  await update($, view, v => ({ ...v, demo: on }))
}

const activeSubs = (v: BuddyView) => v.subs.filter(s => s.state !== 'done').length
const helpersDetail = (n: number) => `on ${n} helper${n === 1 ? '' : 's'}`

// Main goes idle, unless background subs are still working: then it shows them instead.
async function toIdle($: Api, fromTimer = false) {
  await safe(() => pruneSubs($))
  const n = isDemo ? 0 : activeSubs(await read($, view))
  if (n > 0) return setMain($, 'working', { fromTimer, helpers: true, detail: helpersDetail(n) })
  return setMain($, 'idle', { fromTimer })
}

// After the active subs change: enter the helpers state, keep its count, or end it.
async function syncHelpers($: Api) {
  if (isDemo) return
  const v = await read($, view)
  const n = activeSubs(v)
  if (n > 0) {
    if (inHelpers || (pending ?? shown) === 'idle') await setMain($, 'working', { helpers: true, detail: helpersDetail(n) })
  } else if (inHelpers) {
    await setMain($, 'done')
    idleTimer = $.clock.after(DONE_TO_IDLE_MS, () => void toIdle($, true))
  }
}

// A sub whose stop event was lost never ends the helpers state by itself.
async function rescueHelpers($: Api) {
  await safe(() => pruneSubs($))
  await safe(() => syncHelpers($))
}

async function dropSub($: Api, id: string) {
  subTimers.get(id)?.cancel()
  subTimers.delete(id)
  await update($, view, v => ({ ...v, subs: v.subs.filter(s => s.id !== id) }))
}

// Opens the pane on the person's ask and says how it went.
async function openAsked($: Api): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: 'Buddy' })
  return opened.isPlaced ? 'Buddy pane opened.' : `Buddy pane not shown: ${opened.reason ?? 'no room for a pane here'}`
}

async function demoStep($: Api, i: number): Promise<void> {
  const st = DEMO_STATES[i]
  if (st === undefined) {
    await safe(() => setDemo($, false)) // first, so the demo flag is clear when the updates below land
    await safe(() => dropSub($, 'demo-sub'))
    await safe(() => toIdle($))
    $.ui.toast('buddy demo finished')
    return
  }
  await setMain($, st, { demo: true, force: true })
  if (st === 'spawning') await setSub($, 'demo-sub', 'running')
  if (st === 'waiting') await dropSub($, 'demo-sub')
  $.ui.toast(`buddy: ${st}`, { timeoutMs: DEMO_STEP_MS })
  $.clock.after(DEMO_STEP_MS, () => void demoStep($, i + 1))
}

// The mod only observes: a failure in its own bookkeeping never reaches the session.
async function safe(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch {
    // ignore
  }
}

export const register: Register = (on, options) => {
  const minutes = Number(options.cacheTtlMinutes)
  const ttlMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MIN) * 60_000


  on('session.start', async ($, e, next) => {
    await safe(() => $.command.register({ name: 'buddy-demo', description: 'Cycle the buddy through every animation' }))
    await safe(() => $.command.register({ name: 'buddy', description: 'Open the buddy pane' }))
    // A reload runs this again with the stored view but fresh timers: clear leftover demo state.
    await safe(() => resetLeftovers($))
    await safe(() => rescueHelpers($))
    await safe(() => seedUsage($))
    await safe(() => syncCacheTick($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await safe(() => setUsage($, e.context, e.rateLimits))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    askedUser = false
    await safe(() => pruneSubs($))
    await safe(() => seedUsage($)) // the percent can go stale after /model
    await safe(() => setMain($, 'thinking'))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (isHousekeeping(e.tool)) {
      const ask = (e as { ask?: unknown }).ask
      if (!e.agentId && e.tool === 'mcp__ccd_turn__wrap_up') askedUser = typeof ask === 'string' && !!ask.trim()
      return next(e)
    }
    const st = stateForTool(e.tool, e)
    const id = e.agentId
    if (!id) askedUser = false // more work after the ask: the turn no longer ends on it
    if (id) subTimers.get(id)?.cancel()
    await safe(() => (id ? setSub($, id, st) : setMain($, st, { detail: detailFor(e.tool, e) })))
    if (id) await safe(() => syncHelpers($))
    const result = await next(e)
    if (result && 'isError' in result && result.isError) {
      if (id) await safe(() => setSub($, id, 'error'))
      else await safe(() => setMain($, 'error'))
    }
    return result
  }).catch(($, e, next) => next(e))

  // Every main-thread API response refreshes the cache, the final reply too; a subagent has its own cache.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      mainRunning = true
      $.ui.invalidate('ui.render')
    } else {
      // A subagent's first turn (same as classic.SubagentStart); a resumed one must not be dropped by its old timer.
      const id = e.agentId
      subTimers.get(id)?.cancel()
      subTimers.delete(id)
      await safe(() => setSub($, id, 'working'))
      await safe(() => syncHelpers($))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The request start is when the provider refreshes the cache, so that is the stamp.
  on('turn.step', async function* ($, e, next) {
    const t = await $.clock.now()
    const r = yield* next(e)
    if (!e.agentId && r?.usage) await safe(() => stampCache($, t, ttlMs))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      await safe(() => setSub($, id, 'done'))
      await safe(() => syncHelpers($))
      subTimers.get(id)?.cancel()
      subTimers.set(id, $.clock.after(DONE_TO_IDLE_MS, () => void dropSub($, id)))
    } else {
      const asked = askedUser || (e.reason === 'answer' && typeof e.answer === 'string' && e.answer.trim().endsWith('?'))
      askedUser = false
      await safe(() => pruneSubs($))
      mainRunning = false
      $.ui.invalidate('ui.render')
      await safe(() => syncCacheTick($))
      if (asked) await safe(() => setMain($, 'waiting'))
      else {
        await safe(() => setMain($, 'done'))
        idleTimer = $.clock.after(DONE_TO_IDLE_MS, () => void toIdle($, true))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Native twins of the classic PreCompact/PostCompact and SessionStart(clear) hooks below; both sets stay, resets are idempotent.
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    await safe(() => setMain($, 'compacting'))
    let result
    try {
      result = await next(e)
    } catch (err) {
      await safe(() => afterCompact($))
      throw err
    }
    if (result && 'skip' in result && result.skip !== undefined) await safe(() => afterCompact($))
    else {
      await safe(() => afterCompact($))
      await safe(() => seedUsage($))
      await safe(() => forgetCache($))
    }
    return result
  }).catch(($, e, next) => next(e)) // replay-safe: never runs the compaction a second time

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // usage() still reads the ending conversation here: drop its context, keep the limits; the next measure refills it.
      await safe(() => update($, usage, u => u && { ...u, tokens: undefined, percent: undefined }))
      await safe(() => forgetCache($))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    await safe(() => setSub($, e.agent_id, 'working'))
    await safe(() => syncHelpers($))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.SubagentStop', async ($, e, next) => {
    await safe(() => dropSub($, e.agent_id))
    await safe(() => syncHelpers($))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PermissionRequest', async ($, e, next) => {
    const aid = e.agent_id
    if (aid) {
      await safe(() => setSub($, aid, 'waiting'))
      await safe(() => syncHelpers($))
    } else await safe(() => setMain($, 'waiting'))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PreCompact', async ($, e, next) => {
    await safe(() => setMain($, 'compacting'))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostCompact', async ($, e, next) => {
    await safe(() => afterCompact($))
    await safe(() => seedUsage($))
    await safe(() => forgetCache($))
    return next(e)
  }).catch(($, e, next) => next(e))
  // startup, resume, clear, compact and fork: session.start does not fire on /clear.
  on('classic.SessionStart', async ($, e, next) => {
    await safe(() => seedUsage($))
    if (e.source === 'clear' || e.source === 'compact') await safe(() => forgetCache($))
    return next(e)
  }).catch(($, e, next) => next(e))
  // /model changes the window, so the percent, and starts a cold cache.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await safe(() => seedUsage($))
    await safe(() => forgetCache($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'buddy' }, async $ => ({ text: await openAsked($) })).catch(() => ({
    text: 'Buddy pane not shown.',
  }))

  on('command.run', { command: 'buddy-demo' }, async $ => {
    if (isDemo) return { text: 'The buddy demo is already running.' }
    await safe(() => setDemo($, true))
    await demoStep($, 0)
    return { text: `Cycling ${DEMO_STATES.length} buddy states, ${DEMO_STEP_MS / 1000}s each. Watch above the prompt.` }
  }).catch(() => ({ text: '' }))

  // The band above the prompt is the buddy's home: bare, no frame, no background, no isInteractive.
  // Stacked meters (context, 5-hour, 7-day) sit on the left and the buddy on the right. It is up whenever a meter has data;
  // before one, only while something is happening (main busy, demo or an active sub).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    const u = await read($, usage)
    const c = await read($, cache)
    if (e.props.hasSurvey) return next(e)
    const narrow = (e.props.bodyColumns ?? Infinity) < NARROW_COLUMNS
    let rows = meters(u, await $.clock.now(), narrow)
    if (e.props.maxRows !== undefined && e.props.maxRows < 3) rows = rows.slice(0, Math.max(0, e.props.maxRows))
    // A finished sub alone doesn't keep it up (its drop timer can be lost to a hot reload).
    const busy = v.main !== 'idle' || v.demo || v.subs.some(s => s.state !== 'done')
    if (rows.length === 0 && !busy) return next(e)
    const label = labelOf(v)
    const line = e.props.isWorking || mainRunning ? null : cacheLine(c, await $.clock.now())
    const inline = line !== null && rows.length < 2 // the terminal never grows a row: it joins the label row
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Box flexDirection="column" flexShrink={0}>
            {rows.map(m => {
              const [lit, rest] = blockBar(m.pct)
              return (
                <Box key={`meter-${m.label}`} flexDirection="row">
                  <Text dimColor>{`${m.label.padEnd(3)} `}</Text>
                  <Text color={m.tone}>{lit}</Text>
                  <Text dimColor>{rest}</Text>
                  <Text dimColor wrap="truncate-end">{` ${m.text}`}</Text>
                </Box>
              )
            })}
          </Box>
          <Box flexDirection="row">
            {v.subs.map(s => (
              <Text key={`sub-${s.id}`} dimColor>{`${EMOJI[s.state]} `}</Text>
            ))}
            <Box flexDirection="column" alignItems="flex-end">
              <Box flexDirection="row">
                <Text wrap="truncate-end">{`${EMOJI[v.main]} ${label}`}</Text>
                {line && inline && (
                  <Box flexShrink={0}>
                    <Text dimColor>{' · '}</Text>
                    <Text key="cache" dimColor={!line.tone} color={line.tone}>{line.text}</Text>
                  </Box>
                )}
              </Box>
              {line && !inline && <Text key="cache" dimColor={!line.tone} color={line.tone}>{line.text}</Text>}
            </Box>
          </Box>
        </Box>
      )
    }
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%">
        <Box flexDirection="column" flexShrink={0}>
          {rows.map(m => (
            <Box key={`meter-${m.label}`} flexDirection="row" alignItems="center">
              <Box width={4}>
                <Text dimColor>{m.label}</Text>
              </Box>
              <Svg source={barSvg(m.pct, m.tone)} alt={`${m.label} ${m.text}`} width={BAR_W} height={BAR_H} />
              <Text dimColor wrap="truncate-end">{` ${m.text}`}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="row" alignItems="center">
          {v.subs.map(s => (
            <Svg
              key={`sub-${s.id}`}
              source={buddySvg(s.state, 1 + (hash(s.id) % 4), BAND_SUB_PX)}
              alt={`subagent buddy, ${LABELS[s.state]}`}
              width={BAND_SUB_PX}
              height={BAND_SUB_PX}
            />
          ))}
          <Box flexDirection="column" alignItems="flex-end">
            <Text dimColor wrap="truncate-end">{` ${label} `}</Text>
            {line && <Text key="cache" dimColor={!line.tone} color={line.tone}>{`${line.text} `}</Text>}
          </Box>
          <Svg
            key="main"
            source={buddySvg(v.main, 0, BAND_MAIN_PX)}
            alt={`buddy, ${LABELS[v.main]}`}
            width={BAND_MAIN_PX}
            height={BAND_MAIN_PX}
          />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The pane is on request only (/buddy); docked beside the chat, inline above the prompt when the surface has no dock.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const v = await read($, view)
    const line = mainRunning ? null : cacheLine(await read($, cache), await $.clock.now())
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" alignItems="center">
          <Text>{`${EMOJI[v.main]} ${labelOf(v)}`}</Text>
          {line && <Text key="cache" dimColor={!line.tone} color={line.tone}>{line.text}</Text>}
          {v.subs.map(s => (
            <Text key={`sub-${s.id}`} dimColor>{`${EMOJI[s.state]} ${LABELS[s.state]}`}</Text>
          ))}
        </Box>
      )
    }
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" alignItems="center">
        <Svg
          key="main"
          source={buddySvg(v.main, 0, MAIN_PX)}
          alt={`buddy, ${LABELS[v.main]}`}
          width={MAIN_PX}
          height={MAIN_PX}
        />
        <Text>{labelOf(v)}</Text>
        {line && <Text key="cache" dimColor={!line.tone} color={line.tone}>{line.text}</Text>}
        {v.subs.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" justifyContent="center" columnGap={1}>
            {v.subs.map(s => (
              <Box key={`sub-${s.id}`} flexDirection="column" alignItems="center">
                <Svg
                  source={buddySvg(s.state, 1 + (hash(s.id) % 4), SUB_PX)}
                  alt={`subagent buddy, ${LABELS[s.state]}`}
                  width={SUB_PX}
                  height={SUB_PX}
                />
                <Text dimColor>{LABELS[s.state]}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
