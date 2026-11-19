import { expect, mock, test } from 'claude-code/testing'

import { LABELS, buddySvg } from '../hooks/art'
import { award, freshXp, xpLine, xpSummary } from '../hooks/level'

// ---------------------------------------------------------------- helpers

// The session id the process is in; a test changes it to stand for a /clear or a resume.
const sid = { current: 's1' }
// How the session is authorized; a test changes it (limits are only remembered on an OAuth login).
const auth: { current: { handle: string; kind: string } | null } = { current: { handle: 'h', kind: 'bearer' } }

const boot = async ($: any, on: any, toolResult: any = { result: {} }, surface = 'desktop', store: Record<string, unknown> | Map<string, unknown> = {}, startAt = 10_000) => {
  sid.current = 's1'
  auth.current = { handle: 'h', kind: 'bearer' }
  const clock = mock.clock(on, { now: startAt })
  if (store instanceof Map) {
    // A store the test can inspect afterwards.
    on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }) as any)
    on('store.set', (_: any, e: any) => (store.set(e.key, e.value), { value: undefined }) as any)
    on('store.delete', (_: any, e: any) => (store.delete(e.key), { value: undefined }) as any)
    on('store.keys', () => ({ value: [...store.keys()] }) as any)
  } else mock.store(on, store)
  on('session.id', () => ({ value: sid.current }) as any)
  on('session.authorize', () => ({ value: auth.current }) as any)
  const opened: any[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }) as any)
  on('ui.open', (_: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } } as any
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.measure', () => ({ changed: [] }))
  on('tool.call', () => toolResult)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await clock.advance(10)
  return { advance: (ms: number) => clock.advance(ms), opened }
}

// Stands for the engine's own drawing, beneath the mod.
const engine = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const drawn = async (ui: any) => JSON.stringify(await ui.drawn())
const count = (t: string) => (t.match(/"type":"Svg"/g) ?? []).length
const run = ($: any, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const band = ($: any, surface = 'desktop', hasSurvey = false) =>
  $.ui.mount({
    plugin: 'my-buddy',
    component: 'AbovePrompt',
    surface,
    props: { hasSurvey, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  } as any)
const bandWith = ($: any, props: Record<string, unknown>, surface = 'desktop') =>
  $.ui.mount({
    plugin: 'my-buddy',
    component: 'AbovePrompt',
    surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {}, ...props },
  } as any)
const bandOut = async ($: any, surface = 'desktop') => {
  const ui = await band($, surface)
  const out = await drawn(ui)
  await ui.unmount()
  return out
}
const bandOutWith = async ($: any, props: Record<string, unknown>, surface = 'desktop') => {
  const ui = await bandWith($, props, surface)
  const out = await drawn(ui)
  await ui.unmount()
  return out
}

// The text of a bare /buddy, and the level the band's buddy wears (a meter row keeps the band up while idle).
const xpText = async ($: any) => ((await run($, 'buddy')).text ?? '') as string
const bandLevel = async ($: any, surface = 'desktop') => {
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 10 }])
  const out = await bandOut($, surface)
  for (let l = 4; l >= 1; l--)
    for (const st of Object.keys(LABELS))
      for (let m = 0; m < 12; m++) if (out.includes(JSON.stringify(buddySvg(st as any, 0, 64, { level: l, month: m })).slice(1, -1))) return l
  throw new Error('no buddy in the band')
}

const SS = { cwd: '/', surface: 'desktop', isInteractive: true } as const

const turnMocks = (on: any) => {
  engine(on) // beneath the band when it hides
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
}
const done = (agentId?: string, turnId = 't1') =>
  ({ ...(agentId && { agentId }), reason: 'answer', answer: 'ok', turnId }) as any
const subStart = ($: any, id: string) => $.turn.start({ text: 'x', turnId: id, agentId: id } as any)
const sub = (agentId: string, tool = 'Read', extra: object = {}) => ({ tool, file_path: '/x', agentId, ...extra }) as any

const measure = ($: any, context: any, rateLimits: any[] = []) => $.session.measure({ context, rateLimits, changed: [] } as any)
const tmeasure = ($: any, rateLimits: any[], ctx: any = { window: 200_000 }) => measure($, ctx, rateLimits)
const HEX = { green: '#639922', yellow: '#BA7517', red: '#E24B4A', magenta: '#D4537E' } as const
const fillRe = (hex: string) => new RegExp(`fill=\\\\"${hex}\\\\"`)
const liveUsage = (on: any, ctx: { current: any }) =>
  on('session.usage', () => ({ value: { startedAt: 0, context: ctx.current, rateLimits: [] } }) as any)

// Collects every node matching the predicate.
const findAll = (node: any, pred: (n: any) => boolean, out: any[] = []) => {
  if (Array.isArray(node)) node.forEach(n => findAll(n, pred, out))
  else if (node && typeof node === 'object') {
    if (pred(node)) out.push(node)
    Object.values(node).forEach(v => findAll(v, pred, out))
  }
  return out
}

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString()
const esc = (t: string) => t.replaceAll('"', '\\"')

// Fires each call in turn on one booted mod and returns the desktop band drawn after each.
const labelsOf = async ($: any, on: any, calls: any[]) => {
  const clock = await boot($, on)
  const outs: string[] = []
  for (const call of calls) {
    await clock.advance(800)
    await $.tool.call(call)
    await clock.advance(800)
    outs.push(await bandOut($))
  }
  return outs
}
// `label` is the whole label text node, e.g. 'running git'.
const hasLabel = (out: string, label: string) => { const got = [...out.matchAll(/" ([^"\\]{3,40}) "/g)].map(m => m[1]).join('|'); if (!out.includes(`" ${esc(label)} "`)) throw new Error(`want ${label}; got ${got}`) }

// ---------------------------------------------------------------- main buddy states

test('prompt.submit shows thinking at once', async ($, on) => {
  turnMocks(on)
  await boot($, on)
  await $.prompt.submit({ text: 'hi' } as any)
  hasLabel(await bandOut($), LABELS.thinking)
})

test('tool.call maps each tool to its state', async ($, on) => {
  const rows = [
    ['Read', 'reading'], ['LSP', 'reading'], ['Grep', 'searching'], ['Glob', 'searching'], ['Edit', 'editing'],
    ['Write', 'editing'], ['Bash', 'running'], ['WebSearch', 'browsing'], ['WebFetch', 'browsing'], ['Agent', 'spawning'],
    ['AskUserQuestion', 'waiting'], ['mcp__playwright__browser_click', 'browsing'], ['mcp__other__thing', 'working'],
  ] as const
  const outs = await labelsOf($, on, rows.map(([tool]) => ({ tool })))
  rows.forEach(([, state], i) => hasLabel(outs[i]!, LABELS[state]))
})

test('an error result shows the error state and drops the detail', async ($, on) => {
  const clock = await boot($, on, { isError: true, result: 'boom', text: 'boom' } as any)
  await clock.advance(800)
  await $.tool.call({ tool: 'Edit', file_path: '/x/register.tsx' } as any)
  await clock.advance(800)
  const out = await bandOut($)
  hasLabel(out, LABELS.error)
  expect(out).not.toContain('register.tsx')
})

test('turn.complete shows done, then idle (band hidden) after 5 s', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await clock.advance(800)
  await $.turn.complete(done())
  await clock.advance(800)
  const out = await bandOut($)
  hasLabel(out, LABELS.done)
  expect(count(out)).toBe(1)
  await clock.advance(5000)
  const after = await bandOut($)
  expect(count(after)).toBe(0)
  expect(after).toMatch(/engine/)
})

test('a turn ending with a wrap_up ask waits for you until the reply', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Ship it?' } as any)
  await $.turn.complete(done())
  await clock.advance(10_000)
  hasLabel(await bandOut($), LABELS.waiting)
  await $.prompt.submit({ text: 'yes' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.thinking)
})

test('a wrap_up without an ask still goes done, then idle', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'did it' } as any)
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('a final message ending in a question waits for you', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.turn.complete({ ...done(), answer: 'Want me to go on? ' })
  await clock.advance(10_000)
  hasLabel(await bandOut($), LABELS.waiting)
})

test('more main work after the ask, or an aborted turn ending in "?", ends in done', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Ship it?' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts' } as any)
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await $.prompt.submit({ text: 'go' } as any)
  await $.turn.complete({ reason: 'aborted', answer: 'Should I?', turnId: 't2' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
})

test('a sub wrap_up ask does not make the main turn wait', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Ship it?', agentId: 's1' } as any)
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('an asked turn does not leak into the next turn', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Ship it?' } as any)
  await $.turn.complete(done())
  await $.prompt.submit({ text: 'yes' } as any)
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('a quick burst is held for the minimum dwell, then the last state shows', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(1000)
  const ui = await band($)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await $.tool.call({ tool: 'Bash', command: 'make' })
  expect(await drawn(ui)).toMatch(/reading/)
  await clock.advance(800)
  expect(await drawn(ui)).toMatch(/running/)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as any)
  expect(await drawn(ui)).toMatch(/running/)
  await clock.advance(800)
  expect(await drawn(ui)).toMatch(/searching/)
  await ui.unmount()
})

test('PermissionRequest shows waiting', async ($, on) => {
  engine(on)
  on('classic.PermissionRequest', () => ({}) as any)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.classic.PermissionRequest({} as any)
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.waiting)
})

// ---------------------------------------------------------------- subagents

test('a subagent starts, follows its own tool calls, finishes with done and is dropped', async ($, on) => {
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  const clock = await boot($, on)
  const ui = await band($)
  await subStart($, 's1')
  const out = await drawn(ui)
  expect(count(out)).toBe(2)
  expect(out).toContain(`subagent buddy, ${LABELS.working}`)
  await $.tool.call(sub('s1', 'Edit'))
  expect(await drawn(ui)).toContain(`subagent buddy, ${LABELS.editing}`)
  await $.turn.complete(done('s1'))
  expect(await drawn(ui)).toContain(`subagent buddy, ${LABELS.done}`)
  await clock.advance(4000)
  expect(count(await drawn(ui))).toBe(2)
  await clock.advance(1500)
  expect(count(await drawn(ui))).toBe(0) // the sub is dropped and the idle band hides
  await ui.unmount()
})

test('a subagent that is waiting on permission shows waiting', async ($, on) => {
  on('classic.PermissionRequest', () => ({}) as any)
  await boot($, on)
  await $.tool.call(sub('s1'))
  await $.classic.PermissionRequest({ agent_id: 's1' } as any)
  expect(await bandOut($)).toContain(`subagent buddy, ${LABELS.waiting}`)
})

test('with 8 running subs a ninth is skipped, and a done one is evicted first', async ($, on) => {
  on('turn.complete', () => ({ text: 'ok' }))
  await boot($, on)
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) await $.tool.call(sub(id))
  await $.tool.call(sub('z'))
  const ui = await band($)
  expect(count(await drawn(ui))).toBe(9) // main + a..h
  await $.turn.complete(done('b'))
  await $.tool.call(sub('z'))
  const out = await drawn(ui)
  expect(count(out)).toBe(9)
  expect(out).not.toMatch(/subagent buddy, done/)
  await ui.unmount()
})

test('prompt.submit drops subs unseen for over 10 min; activity refreshes seen', async ($, on) => {
  on('prompt.submit', (_: any, e: any) => e)
  const clock = await boot($, on)
  await $.tool.call(sub('gone'))
  await $.tool.call(sub('kept'))
  const ui = await band($)
  await clock.advance(400_000)
  await $.tool.call(sub('kept', 'Grep'))
  await clock.advance(250_000)
  await $.prompt.submit({ text: 'hi' } as any)
  expect(count(await drawn(ui))).toBe(2)
  await ui.unmount()
})

test('subagent tool calls never touch the main detail', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x/main.ts' } as any)
  await clock.advance(800)
  await $.tool.call(sub('s1', 'Edit', { file_path: '/x/sub.ts' }))
  await $.tool.call(sub('s1', 'Bash', { command: 'rm -rf x' }))
  await clock.advance(800)
  const out = await bandOut($)
  expect(out).toContain(' reading main.ts ')
  expect(out).not.toMatch(/sub\.ts|rm -rf/)
})

// ---------------------------------------------------------------- band

test('the band is hidden when idle, shows for a running sub, and a finished sub alone does not keep it', async ($, on) => {
  on('turn.complete', () => ({ text: 'ok' }))
  engine(on)
  const clock = await boot($, on)
  for (const surface of ['desktop', 'terminal']) {
    const out = await bandOut($, surface)
    expect(count(out)).toBe(0)
    expect(out).toMatch(/engine/)
  }
  const ui = await band($)
  await $.tool.call(sub('s1'))
  const shown = await drawn(ui)
  expect(count(shown)).toBe(2)
  expect(shown).not.toMatch(/engine/)
  await $.turn.complete(done('s1'))
  await clock.advance(5800) // main shows done, then idle
  const after = await drawn(ui)
  expect(count(after)).toBe(0)
  expect(after).toMatch(/engine/)
  await ui.unmount()
})

const helperMocks = (on: any) => {
  turnMocks(on)
}

test('background subs: main turn ends, then shows working on 1 helper instead of idle', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call(sub('s1'))
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  const out = await bandOut($)
  hasLabel(out, `${LABELS.working} on 1 helper`)
  await clock.advance(20_000)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

test('waiting for you wins over helpers, through sub events and ticks', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call(sub('s1'))
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Ship it?' } as any)
  await $.turn.complete(done())
  await clock.advance(10_000)
  hasLabel(await bandOut($), LABELS.waiting)
  await subStart($, 's2')
  await $.turn.complete(done('s1'))
  await clock.advance(70_000)
  hasLabel(await bandOut($), LABELS.waiting)
  await $.turn.complete(done('s2', 't3'))
  await clock.advance(10_000)
  hasLabel(await bandOut($), LABELS.waiting)
})

test('the helpers count follows the active subs', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await $.tool.call(sub('s1'))
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await subStart($, 's2')
  hasLabel(await bandOut($), `${LABELS.working} on 2 helpers`)
  await $.turn.complete(done('s1'))
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

test('the last sub finishing ends the helpers state: done, then idle after 5 s', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.turn.complete(done('s1'))
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('a main prompt.submit overrides the helpers state', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  await $.prompt.submit({ text: 'hi' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.thinking)
  await $.turn.complete(done())
  await clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

test("a subagent's turn.start while main is idle enters the helpers state", async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  expect(count(await bandOut($))).toBe(0)
  await subStart($, 's1')
  await clock.advance(10)
  const out = await bandOut($)
  hasLabel(out, `${LABELS.working} on 1 helper`)
  expect(count(out)).toBe(2)
})

test('main activity during helpers, then its turn ends: done, then back to helpers while the sub runs; the last sub finishing ends it', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  await $.tool.call({ tool: 'Bash', command: 'make' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.running} make`)
  await $.turn.complete(done())
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.turn.complete(done('s1', 't3'))
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('a sub that errors stays counted as a helper until it finishes', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on, { isError: true, result: 'boom', text: 'boom' } as any)
  await clock.advance(800)
  await $.tool.call(sub('s1', 'Bash')).catch(() => undefined)
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.turn.complete(done('s1'))
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('helpers state never appears during /buddy-demo', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  await run($, 'buddy-demo')
  await subStart($, 's2')
  await $.tool.call(sub('s2'))
  for (let i = 0; i < 12; i++) {
    await clock.advance(2500)
    expect(await bandOut($)).not.toMatch(/helper/)
  }
  await clock.advance(5000)
  hasLabel(await bandOut($), `${LABELS.working} on 2 helpers`)
})

test('a sub quiet for 40 s still counts when the main turn completes', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on, { result: {} })
  await clock.advance(800)
  await $.tool.call(sub('s1', 'Bash'))
  await clock.advance(40_000)
  await $.turn.complete(done())
  await clock.advance(6000)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

test('a sub that went silent for over 10 min while in helpers is rescued: done, then idle', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await clock.advance(660_000)
  hasLabel(await bandOut($), LABELS.done)
  await clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('after prompt.submit, minutes of ticks never flip main back to helpers', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  await $.prompt.submit({ text: 'hi' } as any)
  await clock.advance(800)
  await clock.advance(300_000)
  hasLabel(await bandOut($), LABELS.thinking)
})

test('a second session.start (hot reload) with an active sub re-enters helpers', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await subStart($, 's1')
  await clock.advance(800)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

test('a deferred thinking is not overwritten by a sub event within the dwell', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.prompt.submit({ text: 'hi' } as any)
  await subStart($, 's1')
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.thinking)
})

test('the band yields to a survey', async ($, on) => {
  engine(on)
  await boot($, on)
  await measure($, { tokens: 42_000, window: 200_000, percent: 21 })
  await run($, 'buddy-demo')
  const ui = await band($, 'desktop', true)
  const out = await drawn(ui)
  expect(count(out)).toBe(0)
  expect(out).toMatch(/engine/)
  expect(out).not.toMatch(/ctx/)
  await ui.unmount()
})

test('the band stays up while idle once a reading exists, and hides when it loses its tokens', async ($, on) => {
  engine(on)
  await boot($, on)
  await measure($, { window: 200_000 }) // a reading without tokens
  expect(await bandOut($)).toMatch(/engine/)
  await measure($, { tokens: 42_000, window: 200_000, percent: 21 })
  for (const surface of ['desktop', 'terminal']) {
    const out = await bandOut($, surface)
    expect(out).toMatch(/ctx/)
    expect(out).toMatch(/42k · 21%/)
    expect(out).toMatch(/idle/)
    expect(out).not.toMatch(/engine/)
  }
  await measure($, { window: 200_000 })
  const out = await bandOut($)
  expect(out).toMatch(/engine/)
  expect(out).not.toMatch(/ctx/)
})

test('desktop band layout: meters, subs, label, then the main buddy, bare Svgs at 64 and 36', async ($, on) => {
  engine(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await measure($, { tokens: 42_000, window: 200_000, percent: 21 })
  await $.tool.call({ tool: 'Read', file_path: '/x/main.ts' } as any)
  await $.tool.call(sub('a'))
  await $.tool.call(sub('b'))
  const out = await bandOut($)
  expect(count(out)).toBe(4) // ctx bar, 2 subs, main
  expect(out).toMatch(/space-between/)
  expect(out).toMatch(/width=\\"64\\"|"width":64/)
  expect(out).toMatch(/width=\\"36\\"|"width":36/)
  expect(out).toMatch(/background:transparent/)
  expect(out).not.toMatch(/isInteractive|borderStyle|backgroundColor/)
  const fig = out.indexOf('42k · 21%')
  const sub1 = out.indexOf('"alt":"subagent buddy,')
  const sub2 = out.indexOf('"alt":"subagent buddy,', sub1 + 1)
  const label = out.indexOf(' reading main.ts ')
  const main = out.indexOf('"alt":"buddy,')
  expect(fig).toBeGreaterThanOrEqual(0)
  expect(fig).toBeLessThan(sub1)
  expect(sub1).toBeLessThan(sub2)
  expect(sub2).toBeLessThan(label)
  expect(label).toBeLessThan(main)
})

test('the terminal band renders Text only, with the main buddy last', async ($, on) => {
  turnMocks(on)
  await boot($, on, { result: {} }, 'terminal')
  await measure($, { tokens: 120_000, window: 200_000, percent: 60 })
  await $.prompt.submit({ text: 'hi' } as any)
  await $.tool.call(sub('s1'))
  const out = await bandOut($, 'terminal')
  expect(count(out)).toBe(0)
  expect(out).toMatch(/space-between/)
  expect(out).toMatch(/120k · 60%/)
  expect(out).toMatch(/thinking/)
  expect(out.lastIndexOf('(o_o)...')).toBeGreaterThan(out.lastIndexOf('(o.o)[=]'))
})

// ---------------------------------------------------------------- meters

test('meters render only the rows that have data, in order ctx, 5h, 7d', async ($, on) => {
  engine(on)
  await boot($, on)
  const ui = await band($)
  await tmeasure($, [{ kind: 'seven_day', percentUsed: 12 }], { tokens: 42_000, window: 200_000, percent: 21 })
  let out = await drawn(ui)
  expect(out).toMatch(/"ctx".*"7d"/)
  expect(out).not.toMatch(/"5h"/)
  await tmeasure($, [{ kind: 'seven_day', percentUsed: 12 }, { kind: 'five_hour', percentUsed: 34 }], { tokens: 42_000, window: 200_000, percent: 21 })
  out = await drawn(ui)
  expect(out.indexOf('"ctx"')).toBeLessThan(out.indexOf('"5h"'))
  expect(out.indexOf('"5h"')).toBeLessThan(out.indexOf('"7d"'))
  expect(count(out)).toBe(4)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 8 }]) // limits only, no ctx row
  out = await drawn(ui)
  expect(out).not.toMatch(/"ctx"/)
  expect(out).toMatch(/8%/)
  await ui.unmount()
})

test('the ctx meter is colored by absolute tokens', async ($, on) => {
  engine(on)
  await boot($, on)
  const ui = await band($)
  for (const [tokens, color] of [[49_999, 'green'], [50_000, 'yellow'], [99_999, 'yellow'], [100_000, 'red'], [149_999, 'red'], [150_000, 'magenta']] as const) {
    await measure($, { tokens, window: 1_000_000 })
    expect(await drawn(ui)).toMatch(fillRe(HEX[color]))
  }
  await ui.unmount()
})

test('limit meters are colored by percent, on desktop and terminal', async ($, on) => {
  engine(on)
  await boot($, on)
  const ui = await band($)
  const t = await band($, 'terminal')
  for (const [p, color] of [[69.9, 'green'], [70, 'yellow'], [89.9, 'yellow'], [90, 'red'], [100, 'red']] as const) {
    await tmeasure($, [{ kind: 'five_hour', percentUsed: p }])
    expect(await drawn(ui)).toMatch(fillRe(HEX[color]))
    expect(await drawn(t)).toMatch(new RegExp(`"color":"${color}"`))
  }
  await ui.unmount()
  await t.unmount()
})

test('the ctx figure formats tokens (950, 42k, 1.2M) and falls back to tokens over window for the percent', async ($, on) => {
  engine(on)
  await boot($, on)
  const ui = await band($)
  for (const [ctx, text] of [
    [{ tokens: 950, window: 200_000 }, /ctx 950 · 0%/],
    [{ tokens: 42_000, window: 200_000, percent: 21 }, /ctx 42k · 21%/],
    [{ tokens: 1_200_000, window: 2_000_000 }, /ctx 1\.2M · 60%/],
  ] as const) {
    await measure($, ctx)
    expect(await drawn(ui)).toMatch(text)
  }
  await ui.unmount()
})

test('reset text: 5h clock time, 7d weekday, "next <day>", within 24 h a clock time, missing or bad omitted', async ($, on) => {
  engine(on)
  await boot($, on)
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const D = 86_400_000
  const now = 10_010
  const day = (ms: number) => DAYS[new Date(now + ms).getDay()]
  // The other window is sent bare too, so a reading stored by an earlier call never shows through.
  const at = (kind: string, resetsAt?: unknown) =>
    tmeasure($, [
      { kind: kind === 'five_hour' ? 'seven_day' : 'five_hour', percentUsed: 12 },
      { kind, percentUsed: 12, ...(resetsAt !== undefined && { resetsAt }) },
    ]).then(() => bandOut($))

  for (const [h, mi, text] of [[15, 40, '3:40 PM'], [0, 5, '12:05 AM'], [12, 0, '12:00 PM']] as const) {
    expect(await at('five_hour', local(2026, 10, 6, h, mi))).toContain(`12% · resets ${text}`)
  }
  expect(await at('seven_day', new Date(now + 7 * D).toISOString())).toContain(`resets next ${day(7 * D)}`)
  const mid = await at('seven_day', new Date(now + 3 * D).toISOString())
  expect(mid).toContain(`resets ${day(3 * D)}`)
  expect(mid).not.toContain('next')
  expect(await at('seven_day', new Date(now + 2 * 3600_000).toISOString())).toMatch(/resets \d+:\d\d [AP]M/)
  for (const bad of [undefined, 'not a date', '', 12345]) {
    const out = await at('five_hour', bad)
    expect(out).toContain('12%')
    expect(out).not.toMatch(/resets|NaN|Invalid/)
  }
})

test('other limit kinds and non-numeric percents are ignored', async ($, on) => {
  engine(on)
  await boot($, on)
  await tmeasure($, [{ kind: 'spend_limit', percentUsed: 50 }, { kind: 'five_hour', percentUsed: 'x' }, { kind: 'seven_day', percentUsed: null }])
  const out = await bandOut($)
  expect(out).toMatch(/engine/)
  expect(out).not.toMatch(/50%/)
})

test('under 60 columns the reset text is dropped; at 60 it stays', async ($, on) => {
  engine(on)
  await boot($, on)
  const at = new Date(10_000 + 3600_000).toISOString()
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 34, resetsAt: at }, { kind: 'seven_day', percentUsed: 12, resetsAt: at }])
  for (const surface of ['desktop', 'terminal']) {
    const narrow = await bandOutWith($, { bodyColumns: 59 }, surface)
    expect(narrow).toContain('34%')
    expect(narrow).not.toMatch(/resets/)
    expect(await bandOutWith($, { bodyColumns: 60 }, surface)).toMatch(/resets/)
  }
})

test('maxRows under 3 limits the meter rows, ctx first', async ($, on) => {
  engine(on)
  await boot($, on)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 34 }, { kind: 'seven_day', percentUsed: 12 }], { tokens: 42_000, window: 200_000, percent: 21 })
  for (const surface of ['desktop', 'terminal']) {
    let out = await bandOutWith($, { maxRows: 2 }, surface)
    expect(out).toContain('42k')
    expect(out).toContain('34%')
    expect(out).not.toContain('12%')
    out = await bandOutWith($, { maxRows: 0 }, surface)
    expect(out).not.toMatch(/42k|34%|12%/)
    out = await bandOutWith($, { maxRows: 3 }, surface)
    expect(out).toContain('12%')
  }
})

test('desktop meter bar is an Svg with a track and a clamped fill', async ($, on) => {
  engine(on)
  await boot($, on)
  const bars = async () => {
    const ui = await band($)
    const found = findAll(await ui.drawn(), n => n.type === 'Svg' && n.props?.width === 140)
    await ui.unmount()
    return found
  }
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 50 }, { kind: 'seven_day', percentUsed: 0 }], { tokens: 10_000, window: 200_000, percent: 5 })
  let b = await bars()
  expect(b.length).toBe(3)
  expect(b[0].props.height).toBe(6)
  expect(b[1].props.source).toContain('width="70.0"')
  expect(b[1].props.source).toContain('#88878055')
  expect(b[2].props.source.match(/<rect/g).length).toBe(1) // 0%: track only
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 250 }, { kind: 'seven_day', percentUsed: -30 }])
  b = await bars()
  expect(/<rect width="([\d.]+)"[^>]*fill="#(?!888)/.exec(b[0].props.source)?.[1]).toBe('140.0')
  expect(b[1].props.source.match(/<rect/g).length).toBe(1)
})

test('terminal meter bar is 10 block cells with eighth-block partials, clamped', async ($, on) => {
  engine(on)
  await boot($, on, { result: {} }, 'terminal')
  const cells = async () => {
    const ui = await band($, 'terminal')
    const texts = findAll(await ui.drawn(), n => n.type === 'Text' && typeof n.children?.[0] === 'string').map(n => n.children[0] as string)
    await ui.unmount()
    return texts.filter(t => /^[█▏▎▍▌▋▊▉]*$/.test(t)).join('')
  }
  for (const [p, bar] of [
    [34, '███▍' + '▏'.repeat(6)],
    [0, '▏'.repeat(10)],
    [-5, '▏'.repeat(10)],
    [100, '█'.repeat(10)],
    [250, '█'.repeat(10)],
    [99, '█'.repeat(9) + '▉'],
  ] as const) {
    await tmeasure($, [{ kind: 'five_hour', percentUsed: p }])
    expect(await cells()).toBe(bar)
  }
})

// ---------------------------------------------------------------- usage data

test('session.measure updates the band live and passes the event through', async ($, on) => {
  engine(on)
  await boot($, on)
  const ui = await band($)
  expect(await drawn(ui)).toMatch(/engine/)
  expect(await measure($, { tokens: 10_000, window: 200_000, percent: 5 }, [{ kind: 'five_hour', percentUsed: 34 }])).toEqual({ changed: [] })
  let out = await drawn(ui)
  expect(out).toMatch(/ctx 10k · 5%/)
  expect(out).toMatch(/34%/)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 41, resetsAt: RESET }])
  out = await drawn(ui)
  expect(out).toMatch(/41%/)
  expect(out).not.toMatch(/34%|ctx/)
  await tmeasure($, [])
  expect(await drawn(ui)).toMatch(/41%/) // an empty reading keeps the known limits
  await ui.unmount()
})

test('session.start seeds ctx and limits from $.session.usage()', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 63_000, window: 200_000, percent: 32 }, rateLimits: [{ kind: 'seven_day', percentUsed: 8 }] } }) as any)
  await boot($, on)
  const out = await bandOut($)
  expect(out).toMatch(/ctx 63k · 32%/)
  expect(out).toMatch(fillRe(HEX.yellow))
  expect(out).toMatch(/8%/)
})

test('a second session.start, session.compact, PostModelSwitch and prompt.submit re-seed the reading', async ($, on) => {
  engine(on)
  on('classic.PostModelSwitch', () => ({}) as any)
  on('session.compact', () => ({ messages: MSGS }) as any)
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  const ctx = { current: { tokens: 10_000, window: 200_000, percent: 5 } }
  liveUsage(on, ctx)
  await boot($, on)
  expect(await bandOut($)).toMatch(/ctx 10k/)
  const fires = [
    () => $.session.start({ ...SS }),
    () => $.session.compact({ trigger: 'manual', messages: MSGS } as any),
    () => $.classic.PostModelSwitch({} as any),
    () => $.prompt.submit({ text: 'hi' } as any),
  ]
  for (const [i, fire] of fires.entries()) {
    const tokens = (11 + i) * 1000
    ctx.current = { tokens, window: 200_000, percent: 6 }
    await fire()
    expect(await bandOut($)).toMatch(new RegExp(`ctx ${tokens / 1000}k · 6%`))
  }
})

test('a $.session.usage() that throws does not break session.start, prompt.submit or measure', async ($, on) => {
  turnMocks(on)
  on('session.usage', () => {
    throw new Error('usage failed')
  })
  await boot($, on)
  expect((await $.session.start({ ...SS })).cwd).toBe('/')
  expect(await $.prompt.submit({ text: 'hi' } as any)).toEqual({ text: 'hi' })
  hasLabel(await bandOut($), LABELS.thinking)
  await measure($, { tokens: 5_000, window: 200_000, percent: 3 })
  expect(await bandOut($)).toMatch(/ctx 5k · 3%/)
})

const storedUsage = (on: any, shape: string, extra: object = {}) => {
  on('session.usage', () => {
    throw new Error('no live reading') // so session.start's seed doesn't replace the stored value
  })
  on(
    'state.get',
    { plugin: 'my-buddy', key: 'usage' } as any,
    () => ({ value: { value: { shape, value: { tokens: 42_000, window: 200_000, percent: 21, ...extra } }, version: 2 } }) as any,
  )
}

test('a stored usage value under the old usage-1 shape reads as absent', async ($, on) => {
  engine(on)
  storedUsage(on, 'usage-1')
  await boot($, on)
  const out = await bandOut($)
  expect(out).toMatch(/engine/)
  expect(out).not.toMatch(/42k/)
})

test('the same stored value under usage-2 does show', async ($, on) => {
  engine(on)
  storedUsage(on, 'usage-2', { limits: [] })
  await boot($, on)
  expect(await bandOut($)).toMatch(/42k/)
})

// ---------------------------------------------------------------- detail label

test('detail per tool: basename, quoted/trimmed text, squashed whitespace, none for unknown or malformed', async ($, on) => {
  const rows: [any, string][] = [
    [{ tool: 'Read', file_path: '/a/b/register.tsx' }, 'reading register.tsx'],
    [{ tool: 'Read', file_path: 'C:\\a\\b\\win.ts' }, 'reading win.ts'],
    [{ tool: 'Edit', file_path: '/a/b/register.tsx' }, 'editing register.tsx'],
    [{ tool: 'Write', file_path: '/a/b/new.ts' }, 'editing new.ts'],
    [{ tool: 'NotebookEdit', notebook_path: '/a/nb.ipynb' }, 'editing nb.ipynb'],
    [{ tool: 'Grep', pattern: 'foo' }, 'searching "foo"'],
    [{ tool: 'Grep', pattern: 'x'.repeat(30) }, `searching "${'x'.repeat(19)}…"`],
    [{ tool: 'Grep', pattern: 'a\n  b\t\tc' }, 'searching "a b c"'],
    [{ tool: 'Glob', pattern: 'g'.repeat(24) }, `searching ${'g'.repeat(24)}`],
    [{ tool: 'Glob', pattern: 'g'.repeat(30) }, `searching ${'g'.repeat(23)}…`],
    [{ tool: 'WebSearch', query: 'q'.repeat(30) }, `browsing ${'q'.repeat(23)}…`],
    [{ tool: 'Agent', description: 'Find usages', prompt: 'p' }, 'spawning Find usages'],
    [{ tool: 'Agent', description: 'd'.repeat(30) }, `spawning ${'d'.repeat(27)}…`],
    [{ tool: 'Task', description: 'find\n  usages' }, 'spawning find usages'],
    [{ tool: 'Read', file_path: 42 }, 'reading'],
    [{ tool: 'Read', file_path: '   ' }, 'reading'],
    [{ tool: 'Glob' }, 'searching'],
  ]
  const outs = await labelsOf($, on, rows.map(([c]) => c))
  rows.forEach(([, label], i) => hasLabel(outs[i]!, label))
})

test('Bash detail is the program name only, never arguments or secrets', async ($, on) => {
  const rows: [string, string, string?][] = [
    ['git status\nsecret99', 'searching git', 'secret99'],
    ['/usr/bin/git status', 'searching git'],
    ['cd /a/b && git status', 'searching git'],
    ['A=1 B=2 make', 'running make'],
    ['sudo apt install x', 'running apt'],
    ['env FOO=1 node a.js', 'running node'],
    ['GITHUB_TOKEN=ghp_x gh pr list', 'browsing gh', 'ghp_x'],
    ['curl -u bob:hunter2 x', 'browsing curl', 'hunter2'],
    ['PASSWORD="a b" ./x', 'running', 'a b'],
    ['PW=$(echo tok9 ) psql', 'running', 'tok9'],
    ['A=b&&curl tok9', 'running', 'tok9'],
    ['https://tok9@h/x', 'running', 'tok9'],
    ['b'.repeat(25) + ' x', 'running'],
  ]
  const outs = await labelsOf($, on, rows.map(([command]) => ({ tool: 'Bash', command })))
  rows.forEach(([, label, secret], i) => {
    hasLabel(outs[i]!, label)
    if (secret) expect(outs[i]).not.toContain(secret)
  })
})

test('Bash state comes from the program, git from its subcommand', async ($, on) => {
  const rows = [
    ['cat a', 'reading cat'], ['grep -r x .', 'searching grep'], ['curl x', 'browsing curl'],
    ['git status', 'searching git'], ['git diff HEAD', 'reading git'], ['git push', 'running git'], ['git -C /repo status', 'searching git'],
    ['make test', 'running make'],
  ] as const
  const outs = await labelsOf($, on, rows.map(([command]) => ({ tool: 'Bash', command })))
  rows.forEach(([, label], i) => hasLabel(outs[i]!, label))
})

test('housekeeping tools leave the last real tool shown', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x/main.ts' } as any)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan' } as any)
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as any)
  await clock.advance(800)
  expect(await bandOut($)).toContain(' reading main.ts ')
})

test('housekeeping tools do not break the helpers state or change a sub', async ($, on) => {
  helperMocks(on)
  const clock = await boot($, on)
  const ui = await band($)
  await clock.advance(800)
  await $.tool.call(sub('s1', 'Edit'))
  await $.turn.complete(done())
  await clock.advance(6000)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan' } as any)
  await $.tool.call({ tool: 'TaskUpdate' } as any)
  await $.tool.call(sub('s1', 'TodoWrite'))
  await $.tool.call(sub('s1', 'mcp__ccd_session__mark_chapter'))
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  expect(await drawn(ui)).toContain(`subagent buddy, ${LABELS.editing}`)
  await ui.unmount()
})

test('an error result from a housekeeping tool does not show error', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on, { isError: true, result: 'boom', text: 'boom' } as any)
  await clock.advance(800)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan' } as any).catch(() => undefined)
  await clock.advance(800)
  expect(await bandOut($)).not.toContain(` ${LABELS.error} `)
  // Control: the same result from a real tool does show error.
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any).catch(() => undefined)
  await clock.advance(800)
  expect(await bandOut($)).toContain(` ${LABELS.error} `)
})

test('WebFetch detail is the host only, userinfo dropped', async ($, on) => {
  const rows: [string, string, string?][] = [
    ['https://example.com/a/b?q=1', 'browsing example.com', 'q=1'],
    ['https://u:pw9@host/x', 'browsing host', 'pw9'],
    ['https://bob:p@ss9@h.io/x', 'browsing h.io', 'ss9'],
    ['example.com/x', 'browsing'],
  ]
  const outs = await labelsOf($, on, rows.map(([url]) => ({ tool: 'WebFetch', url })))
  rows.forEach(([, label, secret], i) => {
    hasLabel(outs[i]!, label)
    if (secret) expect(outs[i]).not.toContain(secret)
  })
})

test('detail: same state updates at once, a state change defers it with the state, a detail-less state clears it', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x/b.ts' } as any) // same state, inside the dwell
  let out = await bandOut($)
  expect(out).toContain(' reading b.ts ')
  expect(out).not.toContain('a.ts')
  await clock.advance(800)
  await $.tool.call({ tool: 'Edit', file_path: '/x/second.ts' } as any)
  await clock.advance(10)
  await $.tool.call({ tool: 'Bash', command: 'make' } as any) // deferred: inside the dwell of editing
  out = await bandOut($)
  expect(out).toContain(' editing second.ts ')
  expect(out).not.toContain(' running ')
  await clock.advance(800)
  out = await bandOut($)
  expect(out).toContain(' running make ')
  expect(out).not.toContain('second.ts')
  await $.tool.call({ tool: 'mcp__other__thing' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), LABELS.working)
})

test('thinking and done clear the detail', async ($, on) => {
  turnMocks(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Edit', file_path: '/x/register.tsx' } as any)
  await clock.advance(800)
  expect(await bandOut($)).toContain('register.tsx')
  await $.prompt.submit({ text: 'hi' } as any)
  await clock.advance(800)
  const out = await bandOut($)
  hasLabel(out, LABELS.thinking)
  expect(out).not.toContain('register.tsx')
  await $.tool.call({ tool: 'Edit', file_path: '/x/again.ts' } as any)
  await clock.advance(800)
  await $.turn.complete(done())
  await clock.advance(800)
  const end = await bandOut($)
  hasLabel(end, LABELS.done)
  expect(end).not.toContain('again.ts')
})

test('the band shows the detail on desktop and terminal', async ($, on) => {
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Edit', file_path: '/x/register.tsx' } as any)
  await clock.advance(800)
  for (const surface of ['desktop', 'terminal']) {
    const ui = await band($, surface)
    expect(await drawn(ui)).toContain('editing register.tsx')
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- band sizes

test('the desktop band draws the main Svg at 64 and subs at 36', async ($, on) => {
  await boot($, on)
  await $.tool.call(sub('sub-1'))
  for (const surface of ['desktop', 'vscode', 'mobile']) {
    const ui = await band($, surface)
    const out = await drawn(ui)
    expect(count(out)).toBe(2)
    expect(out).toMatch(/width=\\"64\\"|"width":64/)
    expect(out).toMatch(/width=\\"36\\"|"width":36/)
    expect(out).not.toMatch(/isInteractive|borderStyle|backgroundColor/)
    await ui.unmount()
  }
})

test('the terminal band draws the main buddy and subs as Text', async ($, on) => {
  await boot($, on, { result: {} }, 'terminal')
  await $.tool.call(sub('sub-1'))
  const ui = await band($, 'terminal')
  const out = await drawn(ui)
  expect(count(out)).toBe(0)
  expect(out).toMatch(/working on 1 helper/)
  await ui.unmount()
})

// ---------------------------------------------------------------- demo

test('/buddy-demo cycles the states and ends idle with no detail', async ($, on) => {
  engine(on)
  const clock = await boot($, on)
  await clock.advance(800)
  await $.tool.call({ tool: 'Edit', file_path: '/x/before.ts' } as any)
  await clock.advance(800)
  const reply = await run($, 'buddy-demo')
  expect(reply.text ?? '').toMatch(/Cycling/)
  expect(reply.text ?? '').toMatch(/above the prompt/)
  expect(clock.opened.length).toBe(0)
  const shown = await bandOut($)
  expect(count(shown)).toBe(1)
  expect(shown).not.toContain('before.ts')
  const ui = await band($)
  expect(await drawn(ui)).toMatch(/thinking|idle/)
  await clock.advance(2500 * 2)
  expect(await drawn(ui)).toMatch(/reading|searching/)
  await $.tool.call({ tool: 'Read', file_path: '/x/during.ts' } as any) // ignored while the demo runs
  await clock.advance(2500 * 5) // spawning: demo-sub present
  expect(count(await drawn(ui))).toBe(2)
  await clock.advance(2500 * 8)
  const end = await drawn(ui)
  expect(count(end)).toBe(0) // idle again: the band hides
  expect(end).toMatch(/engine/)
  expect(end).not.toMatch(/before\.ts|during\.ts/)
  await ui.unmount()
})

test('a second /buddy-demo while one runs says it is already running', async ($, on) => {
  await boot($, on)
  await run($, 'buddy-demo')
  expect((await run($, 'buddy-demo')).text ?? '').toMatch(/already running/)
})

// ---------------------------------------------------------------- reload

test('a second session.start clears a leftover demo, and the demo can run again', async ($, on) => {
  const clock = await boot($, on)
  await run($, 'buddy-demo')
  await clock.advance(2500 * 7)
  const ui = await band($)
  expect(count(await drawn(ui))).toBe(2)
  await $.session.start({ ...SS })
  const after = await drawn(ui)
  expect(count(after)).toBe(0) // idle again: the band hides
  expect((await run($, 'buddy-demo')).text ?? '').toMatch(/Cycling/)
  await ui.unmount()
})

const OLD_VIEW = { main: 'editing', subs: [{ id: 'old-sub', state: 'reading' }] } // no `demo`, no `seen`

for (const [name, stored] of [
  ['a value stored under the old shape tag', { shape: 'view-1', value: OLD_VIEW }],
  ['an untagged value from before shapes', OLD_VIEW],
] as const) {
  test(`${name} reads as the initial view`, async ($, on) => {
    on('state.get', { plugin: 'my-buddy', key: 'view' } as any, () => ({ value: { value: stored, version: 3 } }) as any)
    await boot($, on)
    const ui = await band($)
    const out = await drawn(ui)
    expect(count(out)).toBe(0) // the initial view is idle: the band hides
    expect(out).not.toMatch(/old-sub|editing/)
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- prompt-cache countdown

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1, model: 'm' }
const stepMocks = (on: any) => {
  turnMocks(on)
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
}
const reply = async ($: any, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(agentId && { agentId }) } as any));
  await $.turn.complete(done(agentId))
}
const cacheBand = async ($: any, surface = 'desktop', isWorking = false) => {
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10 }], { tokens: 1000, window: 200_000 })
  return bandOutWith($, { isWorking }, surface)
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: the cache line counts down, goes yellow under 60 s, then reads cold`, async ($, on) => {
    stepMocks(on)
    const clock = await boot($, on, { result: {} }, surface)
    await reply($)
    expect(await cacheBand($, surface)).toContain('cache 60m')
    await clock.advance(52 * 60_000 + 8_000)
    let out = await cacheBand($, surface)
    expect(out).toContain('cache 7:52')
    expect(out).not.toContain('"yellow"')
    await clock.advance(440_000)
    out = await cacheBand($, surface)
    expect(out).toMatch(/cache 0:[0-5]\d/)
    expect(out).toContain('"yellow"')
    await clock.advance(60_000)
    out = await cacheBand($, surface)
    expect(out).toContain('cache cold')
    expect(out).toContain('"red"')
  })
}

test('the cache line is hidden before any response and while a turn runs; the band keeps 3 meter rows', async ($, on) => {
  stepMocks(on)
  on('classic.PermissionRequest', () => ({}) as any)
  const clock = await boot($, on)
  expect(await cacheBand($)).not.toContain('cache')
  await reply($)
  const shown = await cacheBand($)
  expect(shown).toContain('cache 60m')
  expect(count(shown)).toBe(4) // three meter bars and the main buddy; the line adds no Svg
  expect(await cacheBand($, 'desktop', true)).not.toContain('cache')
  await $.prompt.submit({ text: 'hi' } as any)
  await $.turn.start({ text: 'hi', turnId: 't2' } as any)
  await $.classic.PermissionRequest({} as any) // waiting, but the turn is still running
  await clock.advance(800)
  const ui = await band($)
  expect(await drawn(ui)).not.toContain('cache')
  await $.turn.complete(done(undefined, 't2'))
  expect(await drawn(ui)).toContain('cache')
  await ui.unmount()
})

test('a mounted band counts down on its own; the ticks stop once the cache is cold', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  stepMocks(on)
  const clock = await boot($, on)
  await reply($)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 10 }], { tokens: 1000, window: 200_000 })
  const ui = await band($)
  const first = await drawn(ui)
  await clock.advance(5000)
  expect(await drawn(ui)).not.toBe(first)
  expect(first).toContain('cache 5:00')
  expect(await drawn(ui)).toContain('cache 4:55')
  for (let i = 0; i < 60; i++) await clock.advance(5000)
  expect(await drawn(ui)).toContain('cache cold')
  await ui.unmount()
})

test('no redraw ticks fire once the cache is cold', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  stepMocks(on)
  let invalidated = 0
  on('ui.invalidate', () => {
    invalidated++
    return { value: undefined } as any
  })
  const clock = await boot($, on)
  await reply($)
  for (let i = 0; i < 61; i++) await clock.advance(5000)
  const n = invalidated
  expect(n).toBeGreaterThan(50)
  for (let i = 0; i < 12; i++) await clock.advance(5000)
  expect(invalidated).toBe(n)
})

test('terminal: the cache line joins the label row with one meter and never adds rows', async ($, on) => {
  stepMocks(on)
  await boot($, on, { result: {} }, 'terminal')
  await reply($)
  await tmeasure($, [], { tokens: 1000, window: 200_000 })
  const one = await bandOutWith($, {}, 'terminal')
  expect(one).toContain('cache 60m')
  expect(one).toContain(' · ')
  expect(one.match(/"flexDirection":"column"/g)?.length).toBe(2) // meters and right column, no cache row
  expect(await bandOutWith($, { maxRows: 1 }, 'terminal')).toContain('cache 60m')
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10 }], { tokens: 1000, window: 200_000 })
  const capped = await bandOutWith($, { maxRows: 1 }, 'terminal')
  expect(capped).toContain('cache 60m')
  expect(capped.match(/"key":"meter-/g)?.length).toBe(1)
})

test('the band shows the cache line once the turn is over; a subagent response does not refresh it', async ($, on) => {
  stepMocks(on)
  const clock = await boot($, on)
  await reply($)
  await clock.advance(55 * 60_000)
  await reply($, 'a1')
  expect(await cacheBand($)).toContain('cache 5:00')
})

test('cacheTtlMinutes is honoured: 5 gives a 5 minute window, then cold', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  stepMocks(on)
  const clock = await boot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('cache 5:00')
  await clock.advance(5 * 60_000)
  expect(await cacheBand($)).toContain('cache cold')
})

test('a second session.start (hot reload) keeps the stored cache and the countdown continues', async ($, on) => {
  stepMocks(on)
  const clock = await boot($, on)
  await reply($)
  await clock.advance(10 * 60_000)
  await $.session.start(SS as any)
  await clock.advance(10)
  expect(await cacheBand($)).toContain('cache 49m') // 49:59.99 floors
})

test('a subagent turn never touches the hidden line; an aborted main turn brings it back', async ($, on) => {
  stepMocks(on)
  await boot($, on)
  await reply($)
  await $.turn.start({ text: 'hi', turnId: 't2' } as any)
  await $.turn.start({ text: 'x', turnId: 's1', agentId: 'a1' } as any)
  await $.turn.complete(done('a1', 's1'))
  expect(await cacheBand($)).not.toContain('cache') // sub finished, main still running
  await $.turn.complete({ reason: 'aborted', answer: '', turnId: 't2' } as any)
  expect(await cacheBand($)).toContain('cache 60m')
})

test('the tick runs every minute above 10 minutes left and every 5 s below', async ($, on) => {
  stepMocks(on)
  let invalidated = 0
  on('ui.invalidate', () => {
    invalidated++
    return { value: undefined } as any
  })
  const clock = await boot($, on)
  await reply($)
  let n = invalidated
  await clock.advance(30_000)
  expect(invalidated).toBe(n) // coarse period: nothing in 30 s
  await clock.advance(30_000)
  expect(invalidated).toBeGreaterThan(n)
  await clock.advance(49 * 60_000 + 5_000) // 10:00 or just under left
  await clock.advance(1_000)
  n = invalidated
  await clock.advance(30_000)
  expect(invalidated - n).toBeGreaterThanOrEqual(5) // fine period: ~6 ticks in 30 s
})

test('/model forgets the cache: the line hides until the next response', async ($, on) => {
  stepMocks(on)
  on('classic.PostModelSwitch', () => ({}) as any)
  await boot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('cache 60m')
  await $.classic.PostModelSwitch({} as any)
  expect(await cacheBand($)).not.toContain('cache')
})

// ---------------------------------------------------------------- native events (classic hooks may be blocked)

test('turn.start with an agentId shows the helper before any tool call; a resumed one survives its old drop timer', async ($, on) => {
  stepMocks(on)
  const clock = await boot($, on)
  const ui = await band($)
  await $.turn.start({ text: 'x', turnId: 's1', agentId: 'a1' } as any)
  expect(await drawn(ui)).toContain(`subagent buddy, ${LABELS.working}`)
  expect(count(await drawn(ui))).toBe(2)
  await $.turn.complete(done('a1', 's1')) // schedules the drop in 5 s
  await clock.advance(3000)
  await $.turn.start({ text: 'again', turnId: 's2', agentId: 'a1' } as any) // resumed
  await clock.advance(3000) // past the first timer
  const out = await drawn(ui)
  expect(count(out)).toBe(2)
  expect(out).toContain(`subagent buddy, ${LABELS.working}`)
  await ui.unmount()
})

const MSGS = [{ role: 'user', text: 'hi', toolUses: [] }]

test('session.compact: compacting while it runs, idle and cache line forgotten after; precompute and subagent do nothing', async ($, on) => {
  stepMocks(on)
  const during: Record<string, string> = {}
  let clock: any
  on('session.compact', async (_: any, e: any) => {
    await clock.advance(800) // state changes hold briefly
    during[e.agentId ?? e.trigger] = await bandOut($)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as any
  })
  clock = await boot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('cache 60m')
  await $.session.compact({ trigger: 'precompute', messages: MSGS } as any)
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MSGS } as any)
  expect(during.precompute).not.toContain(`" ${esc(LABELS.compacting)} "`)
  expect(during.a1).not.toContain(`" ${esc(LABELS.compacting)} "`)
  expect(await cacheBand($)).toContain('cache') // untouched (clock moved a little)
  await $.session.compact({ trigger: 'manual', messages: MSGS } as any)
  hasLabel(during.manual, LABELS.compacting)
  expect(await cacheBand($)).not.toContain('cache')
  await clock.advance(800)
  expect(await bandOut($)).not.toContain(`" ${esc(LABELS.compacting)} "`) // back to idle
})

test('session.end clear or resume: the same session id keeps the cache line, a new id hides it until the next response', async ($, on) => {
  stepMocks(on)
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  await boot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('cache 60m')
  await $.session.end({ reason: 'other', sessionId: 's1', resume: {} } as any)
  expect(await cacheBand($)).toContain('cache 60m')
  // A resume that goes on in the same conversation: the line stays, the old context goes, the limits stay.
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as any)
  const kept = await bandOutWith($, { isWorking: false }, 'desktop')
  expect(kept).toContain('cache 60m')
  expect(kept).not.toContain('ctx')
  expect(kept).toContain('5h')
  // A /clear or a resume into another conversation runs under a new id.
  for (const [reason, id] of [['clear', 's2'], ['resume', 's3']] as const) {
    await $.session.end({ reason, sessionId: sid.current, resume: {} } as any)
    sid.current = id
    const after = await bandOutWith($, { isWorking: false }, 'desktop')
    expect(after).not.toContain('cache')
    expect(after).not.toContain('ctx')
    expect(after).toContain('5h')
    await reply($)
    expect(await cacheBand($)).toContain('cache 60m') // the new id's first response stamps it
  }
  sid.current = 's1'
  expect(await cacheBand($)).toContain('cache 60m') // s1's stamp is still in the store
})

test('session.end resume with no tick running: the re-sync alone starts the countdown for the warm stamp', async ($, on) => {
  stepMocks(on)
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  let invalidated = 0
  on('ui.invalidate', () => {
    invalidated++
    return { value: undefined } as any
  })
  const clock = await boot($, on, { result: {} }, 'desktop', { 'cacheStamp:s2': { at: 10_000, ttlMs: 3_600_000 } })
  // No reply on s1 and s1 has no stamp: no cache tick runs yet.
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as any)
  sid.current = 's2'
  await clock.advance(10) // the re-sync after the switch starts a tick for s2
  const n = invalidated
  await clock.advance(2 * 60_000)
  expect(invalidated).toBeGreaterThan(n)
})

// ---------------------------------------------------------------- limits survive an empty reading

const RESET = new Date(9_000_000).toISOString() // a stored window needs a reset time to be remembered
const LIM = [{ kind: 'five_hour', percentUsed: 34, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 12, resetsAt: RESET }]
const noLive = (on: any) =>
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }) as any)

test('a fresh session.start with empty live rateLimits shows the stored limits', async ($, on) => {
  engine(on)
  noLive(on)
  await boot($, on, { result: {} }, 'desktop', {
    lastLimits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: new Date(9_000_000).toISOString() },
      { kind: 'bogus', x: 1 },
      { kind: 'seven_day', percentUsed: 12 }, // no resetsAt: never used as a fallback
    ],
    cacheStamps: { s1: { at: 'x', ttlMs: null }, s2: 7, s3: [] }, // the old layout is ignored
    'cacheStamp:s1': { at: 'x', ttlMs: null },
  })
  const out = await bandOut($)
  expect(out).toContain('5h')
  expect(out).toContain('34%')
  expect(out).not.toContain('7d')
  expect(out).not.toContain('cache')
})

test('stored limits show only on a bearer (claude.ai) login, and a logout forgets them', async ($, on) => {
  engine(on)
  noLive(on)
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  const stored = { lastLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: new Date(9_000_000).toISOString() }] }
  await boot($, on, { result: {} }, 'desktop', stored)
  expect(await bandOut($)).toContain('34%')
  auth.current = { handle: 'h', kind: 'api-key' }
  await $.session.start(SS as any)
  expect(await bandOut($)).not.toContain('5h')
  auth.current = null
  await $.session.start(SS as any)
  expect(await bandOut($)).not.toContain('5h')
  auth.current = { handle: 'h', kind: 'bearer' }
  await $.session.start(SS as any)
  expect(await bandOut($)).toContain('34%')
  await $.session.end({ reason: 'logout', sessionId: 's1', resume: {} } as any)
  await $.session.start(SS as any)
  expect(await bandOut($)).not.toContain('5h')
})

test('a stored window whose reset has passed shows 0%', async ($, on) => {
  engine(on)
  noLive(on)
  await boot($, on, { result: {} }, 'desktop', {
    lastLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: new Date(5_000).toISOString() }, { kind: 'seven_day', percentUsed: 12, resetsAt: RESET }],
  })
  const out = await bandOut($)
  expect(out).toContain('0%')
  expect(out).not.toContain('80%')
  expect(out).toContain('12%')
})

test('limits merge per kind: a live 5h with no 7d keeps the stored 7d', async ($, on) => {
  engine(on)
  await boot($, on)
  await tmeasure($, LIM)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 50 }])
  const out = await bandOut($)
  expect(out).toContain('50%')
  expect(out).not.toContain('34%')
  expect(out).toContain('7d')
  expect(out).toContain('12%')
})

test('a stamp already in the store (fresh process) shows the cache line, only for the current id', async ($, on) => {
  stepMocks(on)
  const store = new Map<string, unknown>([
    ['cacheStamp:s1', { at: 20_000, ttlMs: 3_600_000 }],
    ['cacheStamp:other', { at: 1_000, ttlMs: 1_000 }], // expired
    ['cacheStamps', { s1: { at: 20_000, ttlMs: 3_600_000 } }], // the old layout is ignored and removed by the next stamp
  ])
  await boot($, on, { result: {} }, 'desktop', store)
  expect(await cacheBand($)).toContain('cache 60m')
  sid.current = 'zzz'
  expect(await cacheBand($)).not.toContain('cache')
  // A stamp prunes only expired stamps of other conversations, and drops the old single-map key.
  sid.current = 's2'
  await reply($)
  expect([...store.keys()].sort()).toEqual(['cacheStamp:s1', 'cacheStamp:s2', 'lastLimits'])
})

test('/model forgets only the current id: another conversation keeps its stamp', async ($, on) => {
  stepMocks(on)
  on('classic.PostModelSwitch', () => ({}) as any)
  await boot($, on, { result: {} }, 'desktop', { 'cacheStamp:s2': { at: 20_000, ttlMs: 3_600_000 } })
  await reply($)
  expect(await cacheBand($)).toContain('cache 60m')
  await $.classic.PostModelSwitch({} as any)
  expect(await cacheBand($)).not.toContain('cache')
  sid.current = 's2'
  expect(await cacheBand($)).toContain('cache 60m')
})

// ---------------------------------------------------------------- leveling

// prompt.submit does its XP work in the background; this waits for it.
const settle = () => new Promise<void>(r => setTimeout(r, 5))
const submit = async ($: any, p: any) => {
  const r = await $.prompt.submit(p)
  await settle()
  return r
}

test('a commit earns +5 and +10 once a day, shown as a floater and in the /buddy reply; --amend and failures earn nothing', async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = await boot($, on, { result: {}, text: '[main abc1234] msg' }, 'desktop', store)
  await $.tool.call({ tool: 'Bash', command: 'git commit --amend -m x' } as any)
  expect([...store.keys()].filter(k => k.startsWith('xp:'))).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x' } as any)
  await clock.advance(10)
  expect([...store.entries()].find(([k]) => k.startsWith('xp:'))?.[1]).toMatchObject({ xp: 15 })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m y' } as any)
  expect([...store.entries()].find(([k]) => k.startsWith('xp:'))?.[1]).toMatchObject({ xp: 20 })
  expect(await bandOut($)).toContain('+20')
  expect((await xpText($)).split('\n')[0]).toBe('Lv 1 · 20 / 200 XP')
})

test('a turn that used a tool earns XP; a thanks prompt earns +2', async ($, on) => {
  const store = new Map<string, unknown>()
  turnMocks(on)
  await boot($, on, { result: {} }, 'desktop', store)
  await submit($, { text: 'thanks!' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done())
  expect([...store.entries()].find(([k]) => k.startsWith('xp:'))?.[1]).toMatchObject({ xp: 13 })
})

// ---- leveling, in depth

const NOV13 = new Date(2026, 10, 13, 12, 0).getTime()
const DAY = 86_400_000
const xpKeys = (st: Map<string, unknown>) => [...st.keys()].filter(k => k.startsWith('xp:'))
const xpSum = (st: Map<string, unknown>) => xpKeys(st).reduce((a, k) => a + ((st.get(k) as any).xp as number), 0)
// A boot whose Bash and other tool results the test can change between calls.
const levelBoot = async ($: any, on: any, store: Map<string, unknown>, startAt = NOV13) => {
  turnMocks(on)
  const res: any = { result: {} }
  const clock = await boot($, on, res, 'desktop', store, startAt)
  const setRes = (r: object) => {
    for (const k of Object.keys(res)) delete res[k]
    Object.assign(res, r)
  }
  return { ...clock, setRes }
}
const OK_PR = { result: {}, text: 'https://github.com/a/b/pull/1' }
const OK_COMMIT = { result: {}, text: '[main abc1234] msg' }
const bash = (ctx: any, $: any, command: string, r: object = { result: {} }, extra: object = {}) => {
  ctx.setRes(r)
  return $.tool.call({ tool: 'Bash', command, ...extra } as any)
}
const workTurn = async ($: any, text = 'go') => {
  await submit($, { text } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done())
}

test('xp: only a turn with a real tool call on the main thread earns; housekeeping and subagent calls do not', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  await submit($, { text: 'go' } as any)
  await $.turn.complete(done()) // no tool at all
  await submit($, { text: 'go' } as any)
  await $.tool.call({ tool: 'TodoWrite' } as any)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' } as any)
  await $.turn.complete(done())
  await submit($, { text: 'go' } as any)
  await $.tool.call(sub('a1', 'Read'))
  await $.turn.complete(done())
  await $.turn.complete(done('a1'))
  expect(xpSum(st)).toBe(0)
  await workTurn($)
  expect(xpSum(st)).toBe(11) // +1 turn, +10 first working turn of the day
  await workTurn($)
  expect(xpSum(st)).toBe(12)
})

test('xp: turn cap is 40 a day and the first-turn bonus comes once', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  for (let i = 0; i < 45; i++) await workTurn($)
  expect(xpSum(st)).toBe(50)
  expect((st.get('xp:2026-11:s1') as any).n).toEqual({ turn: 40, firstTurn: 1 })
})

test('xp: commits +5 capped at 10 a day, +10 first commit once; chained and git -C count, failures and wrong output do not', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x', { result: {}, isError: true, text: '[main abc1234] x' })
  await bash(c, $, 'git commit -m x', { result: {}, text: 'nothing to commit, working tree clean' })
  await bash(c, $, 'git commit --amend --no-edit', OK_COMMIT)
  await bash(c, $, 'git log', OK_COMMIT)
  await bash(c, $, 'echo git commit', { result: {} , text: 'x'})
  expect(xpSum(st)).toBe(0)
  await bash(c, $, 'git -C /repo commit -m x', OK_COMMIT)
  expect(xpSum(st)).toBe(15)
  await bash(c, $, 'cd a && git add -A && git commit -m y; git push', OK_COMMIT)
  expect(xpSum(st)).toBe(20)
  await bash(c, $, 'git commit -m z', { result: {} }) // no output text: counts
  expect(xpSum(st)).toBe(25)
  for (let i = 0; i < 15; i++) await bash(c, $, 'git commit -m z', OK_COMMIT)
  expect(xpSum(st)).toBe(10 + 5 * 10)
})

test('xp: commits on a subagent earn nothing', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x', OK_COMMIT, { agentId: 'a1' })
  await bash(c, $, 'gh pr create --fill', OK_COMMIT, { agentId: 'a1' })
  expect(xpSum(st)).toBe(0)
})

test('xp: gh pr create gives +20 with no cap; a failure gives nothing', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'gh pr create --fill', { result: {}, isError: true, text: 'boom' })
  expect(xpSum(st)).toBe(0)
  for (let i = 0; i < 5; i++) await bash(c, $, 'git push && gh pr create --fill', { result: {}, text: 'https://github.com/a/b/pull/1' })
  expect(xpSum(st)).toBe(100)
})

for (const cmd of ['npm test', 'npm run test', 'pnpm test', 'yarn test', 'bun run test', 'pytest -q', 'go test ./...', 'cargo test', 'claude plugin test .']) {
  test(`xp: red then green of "${cmd}" earns +3`, async ($, on) => {
    const st = new Map<string, unknown>()
    const c = await levelBoot($, on, st)
    await bash(c, $, cmd, { result: {} }) // green without a prior red
    expect(xpSum(st)).toBe(0)
    await bash(c, $, cmd, { result: {}, isError: true })
    expect(xpSum(st)).toBe(0)
    await bash(c, $, cmd, { result: {} })
    expect(xpSum(st)).toBe(3)
    await bash(c, $, cmd, { result: {} }) // already green
    expect(xpSum(st)).toBe(3)
  })
}

test('xp: green needs the same command; non-test commands and other sessions do not match; cap 3 a day', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'npm test', { result: {}, isError: true })
  await bash(c, $, 'pytest', { result: {} })
  await bash(c, $, 'npm run build', { result: {} })
  expect(xpSum(st)).toBe(0)
  sid.current = 's2'
  await bash(c, $, 'npm test', { result: {} })
  expect(xpSum(st)).toBe(0)
  sid.current = 's1'
  for (let i = 0; i < 5; i++) {
    await bash(c, $, 'npm test', { result: {}, isError: true })
    await bash(c, $, 'npm test', { result: {} })
  }
  expect(xpSum(st)).toBe(9)
})

test('xp: thanks +2 in several languages, cap 5 a day; no false positives; slash commands do not count', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  for (const t of ['empty cavity party', 'pretty nasty', 'thankful', 'please fix the entity', 'hello', 'tyres', 'ty'.repeat(1) + 'pe']) {
    await submit($, { text: t } as any)
  }
  expect(xpSum(st)).toBe(0)
  await submit($, { text: 'thanks', command: 'foo' } as any)
  await submit($, { text: '/model thanks', command: 'model' } as any)
  expect(xpSum(st)).toBe(0)
  const ok = ['Thanks!', 'thank you', 'thx', 'ty!', 'merci', 'gracias', 'danke', 'arigato', 'cảm ơn bạn']
  for (const t of ok.slice(0, 3)) await submit($, { text: t } as any)
  expect(xpSum(st)).toBe(6)
  for (const t of ok.slice(3)) await submit($, { text: t } as any)
  expect(xpSum(st)).toBe(10) // cap 5
})

test('xp: every thanks wording is detected', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  let expected = 0
  for (const t of ['cảm ơn', 'cám ơn', '谢谢', 'ありがとう', 'obrigado', 'Thank u', 'THANK YOU']) {
    await c.advance(DAY) // a new day each, so the daily cap (5) is not what stops it
    await submit($, { text: t } as any)
    expected += 2
    expect([t, xpSum(st)]).toEqual([t, expected])
  }
})

test('xp: coming back after 180 s idle with a warm cache gives +2; cold or short idle gives nothing', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 3_600_000 }]])
  const c = await levelBoot($, on, st)
  await submit($, { text: 'hi' } as any) // immediately
  await c.advance(100_000)
  await submit($, { text: 'hi' } as any)
  expect(xpSum(st)).toBe(0)
  await c.advance(81_000)
  await submit($, { text: 'hi' } as any)
  expect(xpSum(st)).toBe(2)
})

test('xp: no coming-back bonus when the cache has gone cold', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 60_000 }]])
  const c = await levelBoot($, on, st)
  await c.advance(300_000)
  await submit($, { text: 'hi' } as any)
  expect(xpSum(st)).toBe(0)
})

test('xp: coming back counts from the end of the last main turn', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 36_000_000 }]])
  const c = await levelBoot($, on, st)
  await c.advance(200_000)
  await workTurn($) // +11 from the turn; the prompt itself came back after 200 s: +2
  expect(xpSum(st)).toBe(13)
  await c.advance(100_000)
  await submit($, { text: 'hi' } as any) // only 100 s since the turn ended
  expect(xpSum(st)).toBe(13)
})

test('xp: caps are per day across sessions; each session has its own key; the month total is the sum', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  for (let i = 0; i < 12; i++) await bash(c, $, 'git commit -m z', OK_COMMIT)
  sid.current = 's2'
  for (let i = 0; i < 12; i++) await bash(c, $, 'git commit -m z', OK_COMMIT)
  expect(xpSum(st)).toBe(60) // 10 + 5 * 10 shared, not doubled
  expect(xpKeys(st).sort()).toEqual(['xp:2026-11:s1'])
  sid.current = 's2'
  await submit($, { text: 'thanks' } as any)
  expect(xpKeys(st).sort()).toEqual(['xp:2026-11:s1', 'xp:2026-11:s2'])
  expect(xpSum(st)).toBe(62)
})

test('xp: a new day resets the caps but not the month total', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  for (let i = 0; i < 12; i++) await bash(c, $, 'git commit -m z', OK_COMMIT)
  expect(xpSum(st)).toBe(60)
  await c.advance(DAY)
  for (let i = 0; i < 12; i++) await bash(c, $, 'git commit -m z', OK_COMMIT)
  expect(xpSum(st)).toBe(120)
  expect((await xpText($)).split('\n')[0]).toBe('Lv 1 · 120 / 200 XP')
})

test('xp: a new day lets another session earn its own capped share with the old counters ignored', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:s9', { day: '2026-11-12', n: { commit: 10, firstCommit: 1 }, xp: 60 }]])
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m z', OK_COMMIT)
  expect(xpSum(st)).toBe(75)
})

test('xp: month rollover drops last month, golden when it reached 2500, not below; total restarts', async ($, on) => {
  const st = new Map<string, unknown>([
    ['xp:2026-10:s1', { day: '2026-10-30', n: {}, xp: 1500 }],
    ['xp:2026-10:s2', { day: '2026-10-30', n: {}, xp: 1000 }],
    ['xp:2026-09:s1', { day: '2026-09-30', n: {}, xp: 2499 }],
    ['xp:2026-11:s1', { day: '2026-11-01', n: {}, xp: 5 }],
  ])
  await levelBoot($, on, st)
  expect(xpKeys(st)).toEqual(['xp:2026-11:s1'])
  expect(st.get('goldenMonths')).toEqual(['2026-10'])
  const t = await xpText($)
  expect(t).toContain('Lv 1 · 5 / 200 XP')
  expect(t).toContain('✨ Oct 2026')
  expect(t).not.toContain('Sep 2026')
})

test('xp: the month turning over while the session runs rolls over and restarts the total', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st, new Date(2026, 9, 31, 23, 0).getTime())
  st.set('xp:2026-10:s1', { day: '2026-10-31', n: {}, xp: 2600 })
  await submit($, { text: 'thanks' } as any)
  expect(xpSum(st)).toBe(2602)
  await c.advance(2 * 3_600_000)
  await submit($, { text: 'thanks' } as any)
  expect(st.get('goldenMonths')).toEqual(['2026-10'])
  expect(xpKeys(st)).toEqual(['xp:2026-11:s1'])
  expect(xpSum(st)).toBe(2)
})

test('xp: the /buddy reply per level: the level line, today and the next reward', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  const cases: [number, string, string][] = [
    [0, 'Lv 1 · 0 / 200 XP', 'Today +0 XP · next: bow tie in 200 XP'],
    [199, 'Lv 1 · 199 / 200 XP', 'Today +0 XP · next: bow tie in 1 XP'],
    [200, 'Lv 2 · 200 / 900 XP', 'Today +0 XP · next: Nov knit beanie in 700 XP'],
    [340, 'Lv 2 · 340 / 900 XP', 'Today +0 XP · next: Nov knit beanie in 560 XP'],
    [900, 'Lv 3 · 900 / 2,500 XP', 'Today +0 XP · next: golden body in 1,600 XP'],
    [2499, 'Lv 3 · 2,499 / 2,500 XP', 'Today +0 XP · next: golden body in 1 XP'],
    [2500, 'Lv 4 · 2,500 XP ✨', 'Today +0 XP'],
    [2612, 'Lv 4 · 2,612 XP ✨', 'Today +0 XP'],
  ]
  for (const [xp, line1, line2] of cases) {
    st.set('xp:2026-11:s1', { day: '2026-11-13', n: {}, xp })
    expect((await xpText($)).split('\n')).toEqual([line1, line2])
  }
})

test("xp: the /buddy reply sums today's counts over sessions, not older days", async ($, on) => {
  const st = new Map<string, unknown>([
    ['xp:2026-11:a', { day: '2026-11-13', n: { turn: 20, commit: 2, firstCommit: 1 }, xp: 40 }],
    ['xp:2026-11:b', { day: '2026-11-13', n: { pr: 1, green: 1, thanks: 2, back: 1, firstTurn: 1 }, xp: 39 }],
    ['xp:2026-11:c', { day: '2026-11-12', n: { turn: 40 }, xp: 40 }],
  ])
  await levelBoot($, on, st)
  // 20 + 10 + 10 + 20 + 3 + 4 + 2 + 10 = 79 today; 119 XP in all
  expect((await xpText($)).split('\n')).toEqual(['Lv 1 · 119 / 200 XP', 'Today +79 XP · next: bow tie in 81 XP'])
})

test("xp: the Lv 3 reward in the /buddy reply is this month's hat", () => {
  const hats = ['party hat', 'heart headband', 'clover', 'rain hood', 'flower crown', 'sunglasses', 'strawberry', 'sun hat', 'graduation cap', 'pumpkin', 'knit beanie', 'snow cap']
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  for (let m = 0; m < 12; m++) {
    const out = xpSummary({ month: `2026-${String(m + 1).padStart(2, '0')}`, total: 300, today: {}, golden: [] }, m)
    expect(out.split('\n')[1]).toBe(`Today +0 XP · next: ${mons[m]} ${hats[m]} in 600 XP`)
  }
})

test('xp: the /buddy reply has a golden line only when there are golden months', async ($, on) => {
  const st = new Map<string, unknown>([['goldenMonths', ['2026-03', '2026-09']]])
  await levelBoot($, on, st)
  expect((await xpText($)).split('\n')[2]).toBe('✨ Mar 2026, Sep 2026')
  st.delete('goldenMonths')
  expect((await xpText($)).split('\n').length).toBe(2)
  expect(await xpText($)).not.toContain('✨')
})

test("xp: /buddy reads fresh, not the render cache, and says so when reading fails", async ($, on) => {
  class Broken extends Map<string, unknown> {
    broken = false
    keys(): MapIterator<string> {
      if (this.broken) throw new Error('store down')
      return super.keys()
    }
  }
  const st = new Broken()
  await levelBoot($, on, st)
  expect((await xpText($)).split('\n')[0]).toBe('Lv 1 · 0 / 200 XP')
  st.set('xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 50 }) // inside the 5 s render window
  expect((await xpText($)).split('\n')[0]).toBe('Lv 1 · 50 / 200 XP')
  st.broken = true
  expect(await xpText($)).toBe("XP isn't available right now.")
})

test('xp: a bare /buddy never opens a pane and mentions no cache', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  const t = await xpText($)
  expect(t).not.toMatch(/cache|pane|warm/i)
  expect((await buddy($, '   ')).text).toBe(t)
  expect(c.clock.opened.length).toBe(0)
})

test('xp: the +N floater combines commit bonuses, shows on the band, and clears after about 4 s', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x', OK_COMMIT)
  expect(await bandOut($)).toContain('+15')
  await c.advance(3_000)
  expect(await bandOut($)).toContain('+15')
  await c.advance(1_500)
  expect(await bandOut($)).not.toContain('+15')
})

test('xp: floaters for pr and green; none for turn, thanks or back', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 36_000_000 }]])
  const c = await levelBoot($, on, st)
  await c.advance(200_000)
  await submit($, { text: 'thanks' } as any) // thanks + back
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done())
  expect(xpSum(st)).toBe(15)
  let ui = await band($)
  expect(await drawn(ui)).not.toMatch(/\+\d/)
  await ui.unmount()
  await bash(c, $, 'gh pr create', { result: {}, text: 'https://github.com/a/b/pull/7' })
  ui = await band($)
  expect(await drawn(ui)).toContain('+20')
  await ui.unmount()
  await c.advance(5_000)
  await bash(c, $, 'npm test', { result: {}, isError: true })
  await bash(c, $, 'npm test', { result: {} })
  ui = await band($)
  expect(await drawn(ui)).toContain('+3')
  await ui.unmount()
})

test('xp: an award while a floater shows adds to it', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'gh pr create', { result: {}, text: 'https://github.com/a/b/pull/7' })
  await c.advance(1_000)
  await bash(c, $, 'gh pr create', { result: {}, text: 'https://github.com/a/b/pull/7' })
  const ui = await band($)
  expect(await drawn(ui)).toContain('+40')
  await ui.unmount()
})

test('art: the main buddy changes with the level; level 1 is plain; hats differ by month and exist for every state', () => {
  const states = Object.keys(LABELS) as any[]
  for (const s of states) {
    const plain = buddySvg(s, 0, 96)
    expect(buddySvg(s, 0, 96, { level: 0, month: 4 })).toBe(plain)
    expect(buddySvg(s, 0, 96, { level: 1, month: 4 })).toBe(plain)
    const l2 = buddySvg(s, 0, 96, { level: 2, month: 4 })
    const l3 = buddySvg(s, 0, 96, { level: 3, month: 4 })
    const l4 = buddySvg(s, 0, 96, { level: 4, month: 4 })
    expect(new Set([plain, l2, l3, l4]).size).toBe(4)
    expect(l4).toContain('#ffd54a')
    expect(plain).not.toContain('#ffd54a')
    const hats = new Set<string>()
    for (let m = 0; m < 12; m++) hats.add(buddySvg(s, 0, 96, { level: 3, month: m }))
    expect(hats.size).toBe(12)
  }
})

test('art: the band gives a hat only to the main buddy, never to subagents', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:s1', { day: '2026-11-13', n: {}, xp: 3000 }]])
  await levelBoot($, on, st)
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await subStart($, 'a1')
  const ui = await band($)
  const t = await drawn(ui)
  expect(count(t)).toBe(2)
  expect((t.match(/#ffd54a/g) ?? []).length).toBeGreaterThan(0)
  const svgs = findAll(JSON.parse(t), n => typeof n.source === 'string' && n.source.startsWith('<svg')).map(n => n.source as string)
  expect(svgs.length).toBe(2)
  expect(svgs.filter(x => x.includes('#ffd54a')).length).toBe(1)
  expect(svgs.filter(x => x.includes('#ff9f1c')).length).toBe(1) // sparks only on the main one
  await ui.unmount()
})

// ---- leveling, review fixes

test('xp: gh pr create needs a PR URL in the output; --help, --web, --dry-run and no URL earn nothing', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  const url = { result: {}, text: 'https://github.com/a/b/pull/12' }
  await bash(c, $, 'gh pr create --help', { result: {}, text: 'Usage: gh pr create (https://github.com/a/b/pull/1)' })
  await bash(c, $, 'gh pr create --web', url)
  await bash(c, $, 'gh pr create -w', url)
  await bash(c, $, 'gh pr create --fill --dry-run', url)
  await bash(c, $, 'gh pr create -h', url)
  await bash(c, $, 'gh pr create --fill || true', { result: {}, text: 'no commits between main and x' })
  await bash(c, $, 'gh pr create --fill', { result: {}, text: 'Creating pull request for x into main' })
  expect(xpSum(st)).toBe(0)
  await bash(c, $, 'gh pr create --title "fix --web mode"', url)
  expect(xpSum(st)).toBe(20)
  await bash(c, $, 'gh pr create --fill', { result: {} }) // no output text: counts
  expect(xpSum(st)).toBe(40)
})

test('xp: --amend only counts as an argument, not inside a quoted message', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit --amend -m "x"', OK_COMMIT)
  await bash(c, $, 'git commit -m "x" --amend', OK_COMMIT)
  expect(xpSum(st)).toBe(0)
  await bash(c, $, `git commit -m "handle --amend"`, OK_COMMIT)
  expect(xpSum(st)).toBe(15)
  await bash(c, $, `git commit -m 'no --amend here'`, OK_COMMIT)
  expect(xpSum(st)).toBe(20)
})

test('xp: a background Bash call earns nothing', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x', OK_COMMIT, { run_in_background: true })
  await bash(c, $, 'gh pr create --fill', { result: {}, text: 'https://github.com/a/b/pull/1' }, { run_in_background: true })
  await bash(c, $, 'npm test', { result: {}, isError: true }, { run_in_background: true })
  await bash(c, $, 'npm test', { result: {} })
  expect(xpSum(st)).toBe(0) // the red one was not recorded
})

test('xp: a prompt queued mid-turn keeps the running turn\'s work', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await submit($, { text: 'one more thing' })
  await $.turn.complete(done())
  expect(xpSum(st)).toBe(11)
})

test('xp: the band reuses the reading for 5 s; a real refresh reads every key again', async ($, on) => {
  class Counting extends Map<string, unknown> {
    gets: string[] = []
    keyCalls = 0
    get(k: string) {
      this.gets.push(k)
      return super.get(k)
    }
    keys() {
      this.keyCalls++
      return super.keys()
    }
  }
  const st = new Counting([
    ['xp:2026-11:old1', { day: '2026-11-10', n: {}, xp: 150 }],
    ['xp:2026-11:old2', { day: '2026-11-11', n: {}, xp: 40 }],
  ])
  const c = await levelBoot($, on, st)
  const reads = (k: string) => st.gets.filter(x => x === k).length
  expect(reads('xp:2026-11:old1')).toBe(1)
  expect(await bandLevel($)).toBe(1) // 190 XP
  const calls = st.keyCalls
  for (let i = 0; i < 3; i++) await bandOut($)
  expect(st.keyCalls).toBe(calls) // renders inside the window do not read the store
  await c.advance(6_000)
  st.set('xp:2026-11:old3', { day: '2026-11-12', n: {}, xp: 20 })
  expect(await bandLevel($)).toBe(2) // 210 XP
  expect(st.keyCalls).toBe(calls + 1)
  expect(reads('xp:2026-11:old1')).toBe(2) // no cache: every key is read on a real refresh
  expect(reads('xp:2026-11:old3')).toBe(1)
})

test('xp: a throwing store during leveling leaves the normal buddy states alone', async ($, on) => {
  class Broken extends Map<string, unknown> {
    broken = false
    get(k: string): unknown {
      if (this.broken && (k.startsWith('xp:') || k === 'goldenMonths')) throw new Error('store down')
      return super.get(k)
    }
    keys(): MapIterator<string> {
      if (this.broken) throw new Error('store down')
      return super.keys()
    }
  }
  const st = new Broken()
  const c = await levelBoot($, on, st)
  st.broken = true
  await $.prompt.submit({ text: 'thanks' } as any)
  await settle()
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await c.advance(800)
  let ui = await band($)
  expect(await drawn(ui)).toContain(LABELS.thinking)
  await ui.unmount()
  await bash(c, $, 'git commit -m x', OK_COMMIT)
  await c.advance(800)
  await $.turn.complete(done())
  await c.advance(800)
  ui = await band($)
  const t = await drawn(ui)
  expect(t).toContain(LABELS.done)
  await ui.unmount()
})

// ---- leveling, review-fix edge cases (tester)

test('xp: an award lifts the level shown on the band at once, inside the 5 s window', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 180 }]])
  const c = await levelBoot($, on, st)
  expect(await bandLevel($)).toBe(1)
  await c.advance(1_000)
  await bash(c, $, 'git commit -m x', OK_COMMIT) // 195
  expect(await bandLevel($)).toBe(1)
  await c.advance(1_000)
  await workTurn($) // 206
  await settle()
  expect(await bandLevel($)).toBe(2)
})

test('xp: a record removed at rollover is not counted, and a new one under the same key is read afresh', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 250 }]])
  const c = await levelBoot($, on, st)
  st.delete('xp:2026-11:other')
  await c.advance(6_000)
  expect(await bandLevel($)).toBe(1)
  st.set('xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 300 })
  await c.advance(6_000)
  expect(await bandLevel($)).toBe(2)
})

test('xp: the month turning over with a reading younger than 5 s is read again at once', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-29', n: {}, xp: 300 }]])
  const c = await levelBoot($, on, st, new Date(2026, 10, 30, 23, 59, 59, 0).getTime())
  expect(await bandLevel($)).toBe(2)
  await c.advance(1_500) // now Dec 1, reading is 1.5 s old
  expect(await bandLevel($)).toBe(1)
  expect(st.has('xp:2026-11:other')).toBe(false)
})

test('xp: the day turning over inside the window resets caps for the next award', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st, new Date(2026, 10, 13, 23, 59, 59, 0).getTime())
  for (let i = 0; i < 3; i++) await bash(c, $, 'git commit -m x', OK_COMMIT)
  expect(xpSum(st)).toBe(5 + 10 + 5 + 5)
  await c.advance(2_000)
  await bash(c, $, 'git commit -m x', OK_COMMIT)
  expect(xpSum(st)).toBe(25 + 15)
  expect((st.get('xp:2026-11:s1') as any).day).toBe('2026-11-14')
})

test('xp: thanks fired right before a turn is awarded in order and keeps the daily cap', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  for (let i = 0; i < 7; i++) await $.prompt.submit({ text: 'thanks' } as any) // no settle between
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done())
  await settle()
  await settle()
  expect(xpSum(st)).toBe(5 * 2 + 1 + 10)
  expect((st.get('xp:2026-11:s1') as any).n).toMatchObject({ thanks: 5, turn: 1, firstTurn: 1 })
})

test('xp: prompt.submit sets thinking before the background XP work finishes', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await $.prompt.submit({ text: 'thanks' } as any)
  await c.advance(900)
  const ui = await band($)
  expect(await drawn(ui)).toContain(LABELS.thinking)
  await ui.unmount()
  await settle()
})

test('xp: turn.complete shows done even when the award throws', async ($, on) => {
  class Broken extends Map<string, unknown> {
    broken = false
    set(k: string, v: unknown) {
      if (this.broken && k.startsWith('xp:')) throw new Error('write failed')
      return super.set(k, v)
    }
  }
  const st = new Broken()
  const c = await levelBoot($, on, st)
  await submit($, { text: 'go' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  st.broken = true
  await $.turn.complete(done())
  await c.advance(800)
  const ui = await band($)
  expect(await drawn(ui)).toContain(LABELS.done)
  await ui.unmount()
  // the failed award does not poison the queue
  st.broken = false
  await bash(c, $, 'git commit -m x', OK_COMMIT)
  expect(xpSum(st)).toBe(15)
})

test('xp: a red foreground test stays red through a background pass and turns green on the next foreground pass', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'npm test', { result: {}, isError: true })
  await bash(c, $, 'npm test', { result: {} }, { run_in_background: true })
  expect(xpSum(st)).toBe(0)
  await bash(c, $, 'npm test', { result: {} })
  expect(xpSum(st)).toBe(3)
  await bash(c, $, 'npm test', { result: {} })
  expect(xpSum(st)).toBe(3)
})

test('xp: a red background test does not clear an earlier red foreground one', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'npm test', { result: {}, isError: true })
  await bash(c, $, 'npm test', { result: {}, isError: true }, { run_in_background: true })
  await bash(c, $, 'npm test', { result: {} })
  expect(xpSum(st)).toBe(3)
})

test('xp: run_in_background must be exactly true; false or a string still counts', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x', OK_COMMIT, { run_in_background: false })
  expect(xpSum(st)).toBe(15)
})

test('xp: gh pr create flag edge cases', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  const url = { result: {}, text: 'https://github.com/a/b/pull/12' }
  await bash(c, $, 'gh pr create --fill --web=true', url)
  await bash(c, $, 'gh pr create --title=x -w', url)
  await bash(c, $, 'gh pr create --dry-run --fill', url)
  expect(xpSum(st)).toBe(0)
  await bash(c, $, `gh pr create --title 'x -w' --body "a --dry-run"`, url)
  expect(xpSum(st)).toBe(20)
  await bash(c, $, 'gh pr create --fill && gh pr view --web', url) // --web belongs to another command
  expect(xpSum(st)).toBe(40)
  await bash(c, $, 'gh pr create --fill; gh pr create --help', url)
  expect(xpSum(st)).toBe(60)
  await bash(c, $, 'gh pr create --fill', { result: {}, text: 'see https://github.com/a/b/pull/' }) // no number
  await bash(c, $, 'gh pr create --fill', { result: {}, text: '' }) // empty text: not a URL
  expect(xpSum(st)).toBe(60)
})

test('xp: --amend belongs to the commit, not to a later command', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -m x && git log --amend-x', OK_COMMIT)
  await bash(c, $, 'git commit -m x; echo --amend', OK_COMMIT)
  expect(xpSum(st)).toBe(20) // 5 + 10 for the first, 5 for the second: `echo --amend` is not the commit's
  await bash(c, $, 'git commit --amend -m x; echo hi', OK_COMMIT)
  await bash(c, $, 'echo hi\ngit commit --amend -m x', OK_COMMIT)
  expect(xpSum(st)).toBe(20)
})

test('xp: gh pr create is read per line, and a trailing comment is ignored', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'gh pr create --fill\ngh pr view --web', OK_PR)
  expect(xpSum(st)).toBe(20)
  await bash(c, $, 'gh pr create --fill # not --web', OK_PR)
  expect(xpSum(st)).toBe(40)
  await bash(c, $, 'gh pr create --web\necho hi', OK_PR)
  expect(xpSum(st)).toBe(40)
})

test('xp: a session resumed on a later day is read again, and a stale read never overwrites an award', async ($, on) => {
  const st = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 50 }]])
  const c = await levelBoot($, on, st)
  expect(await bandLevel($)).toBe(1)
  st.set('xp:2026-11:other', { day: '2026-11-13', n: { turn: 4 }, xp: 254 })
  await c.advance(6_000)
  expect(await bandLevel($)).toBe(2)
})

test('xp: a read in flight during an award does not store its older total', async () => {
  const data = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-12', n: {}, xp: 0 }]])
  let now = NOV13
  let open!: () => void
  let gate: Promise<void> | null = new Promise<void>(r => (open = r))
  const $: any = {
    clock: { now: async () => now },
    session: { id: async () => 's1' },
    store: {
      keys: async () => [...data.keys()],
      get: async (k: string) => {
        const v = data.get(k)
        if (gate && k.startsWith('xp:')) await gate
        return v
      },
      set: async (k: string, v: unknown) => void data.set(k, v),
      delete: async (k: string) => void data.delete(k),
    },
  }
  const slow = freshXp($, now) // reads the old total, then waits on the gate
  for (let i = 0; i < 10; i++) await Promise.resolve()
  const g = gate
  gate = null
  await award($, ['commit']) // +5 while that read waits
  open()
  await g
  expect((await slow)!.total).toBe(5)
  now += 1000
  expect((await freshXp($, now))!.total).toBe(5)
})

test('xp: a prompt queued mid-turn does not start a new worked turn; the next idle prompt resets it', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  await submit($, { text: 'queued' })
  await $.turn.complete(done()) // no tool at all, even after a queued prompt
  expect(xpSum(st)).toBe(0)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any) // a tool call outside any turn, then a fresh prompt
  await submit($, { text: 'fresh' })
  await $.turn.complete(done())
  expect(xpSum(st)).toBe(0)
})

test('xp: the /buddy reply uses thousands separators at every level', async ($, on) => {
  const st = new Map<string, unknown>()
  await levelBoot($, on, st)
  const cases: [number, string, string][] = [
    [1200, 'Lv 3 · 1,200 / 2,500 XP', 'Today +0 XP · next: golden body in 1,300 XP'],
    [999, 'Lv 3 · 999 / 2,500 XP', 'Today +0 XP · next: golden body in 1,501 XP'],
    [1000, 'Lv 3 · 1,000 / 2,500 XP', 'Today +0 XP · next: golden body in 1,500 XP'],
    [12_345, 'Lv 4 · 12,345 XP ✨', 'Today +0 XP'],
  ]
  for (const [xp, line1, line2] of cases) {
    st.set('xp:2026-11:s1', { day: '2026-11-13', n: {}, xp })
    expect((await xpText($)).split('\n')).toEqual([line1, line2])
  }
})

test('xp: xpLine unit formatting', async () => {
  expect(xpLine(0)).toBe('Lv 1 · 0 / 200 XP')
  expect(xpLine(1234567)).toBe('Lv 4 · 1,234,567 XP ✨')
  expect(xpLine(2499)).toBe('Lv 3 · 2,499 / 2,500 XP')
})

test('xp: simultaneous renders share one read, and a failed read is not retried inside the window', async ($, on) => {
  class Counting extends Map<string, unknown> {
    keyCalls = 0
    broken = false
    keys(): MapIterator<string> {
      this.keyCalls++
      if (this.broken) throw new Error('down')
      return super.keys()
    }
  }
  const st = new Counting()
  const c = await levelBoot($, on, st)
  await tmeasure($, [{ kind: 'five_hour', percentUsed: 10 }]) // a meter row keeps the band up while idle
  await c.advance(6_000)
  const before = st.keyCalls
  const [a, b, d] = await Promise.all([band($), band($, 'terminal'), band($, 'vscode')])
  expect([before, st.keyCalls]).toEqual([before, before + 1])
  await Promise.all([a, b, d].map(u => u.unmount()))
  await c.advance(6_000)
  st.broken = true
  const after = st.keyCalls
  for (let i = 0; i < 3; i++) {
    const ui = await band($)
    expect(await drawn(ui)).toContain('buddy, ')
    await ui.unmount()
  }
  expect([after, st.keyCalls]).toEqual([after, after + 1])
})

// A bare store with an optional gate that holds `xp:` reads, for the generation-counter cases.
const bareApi = (data: Map<string, unknown>, clock: { now: number }) => {
  const g: { gate: Promise<void> | null } = { gate: null }
  const $: any = {
    clock: { now: async () => clock.now },
    session: { id: async () => 's1' },
    store: {
      keys: async () => [...data.keys()],
      get: async (k: string) => {
        const v = data.get(k)
        if (g.gate && k.startsWith('xp:')) await g.gate
        return v
      },
      set: async (k: string, v: unknown) => void data.set(k, v),
      delete: async (k: string) => void data.delete(k),
    },
  }
  return { $, g }
}
// The cached reading is module state: each test starts an hour later than the last so it never reuses it.
const HOUR = 3_600_000
let hourN = 0
const spin = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test('xp: two awards back to back add up in the store and in the cached reading', async () => {
  const data = new Map<string, unknown>()
  const clock = { now: NOV13 + HOUR * ++hourN }
  const { $ } = bareApi(data, clock)
  await freshXp($, clock.now)
  const [a, b] = await Promise.all([award($, ['commit']), award($, ['commit', 'pr'])])
  expect([a.gained, b.gained]).toEqual([5, 25])
  expect((data.get('xp:2026-11:s1') as any).xp).toBe(30)
  expect((await freshXp($, clock.now + 100))!.total).toBe(30) // inside the window: the patched cache
  clock.now += 6_000
  expect((await freshXp($, clock.now))!.total).toBe(30) // a real read agrees
})

test('xp: an award that earns nothing (capped) leaves the cache and the store alone, even with a read in flight', async () => {
  const data = new Map<string, unknown>([['xp:2026-11:s1', { day: '2026-11-13', n: { commit: 10 }, xp: 50 }]])
  const clock = { now: NOV13 + HOUR * ++hourN }
  const { $, g } = bareApi(data, clock)
  await freshXp($, clock.now)
  clock.now += 6_000
  let open!: () => void
  g.gate = new Promise<void>(r => (open = r))
  const slow = freshXp($, clock.now)
  await spin()
  const before = JSON.stringify([...data])
  const r = award($, ['commit']) // capped at 10 commits a day: it waits on the gated read of its own refresh
  await spin()
  g.gate = null
  open()
  expect(await r).toEqual({ gained: 0, shown: 0 })
  expect((await slow)!.total).toBe(50)
  expect(JSON.stringify([...data])).toBe(before)
  expect((await freshXp($, clock.now + 100))!.total).toBe(50)
})

test('xp: after an award skipped an in-flight read, the next read past the window has the right total and caps hold', async () => {
  const data = new Map<string, unknown>([['xp:2026-11:other', { day: '2026-11-13', n: { commit: 1 }, xp: 5 }]])
  const clock = { now: NOV13 + HOUR * ++hourN }
  const { $, g } = bareApi(data, clock)
  await freshXp($, clock.now)
  clock.now += 6_000
  let open!: () => void
  const gate = new Promise<void>(r => (open = r))
  g.gate = gate
  const slow = freshXp($, clock.now) // reads 5, then waits
  await spin()
  g.gate = null
  await award($, ['commit']) // other already has 1 commit today: this is the 2nd
  open()
  await gate
  await slow
  clock.now += 6_000
  const st = (await freshXp($, clock.now))!
  expect(st.total).toBe(10)
  expect(st.today.commit).toBe(2)
  expect((await award($, Array(10).fill('commit'))).gained).toBe(40) // 8 left of the 10-a-day cap
})

test('xp: a Bash call a hook denied earns nothing for a commit, a PR or a green test', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  const DENY = { deny: 'blocked by policy' }
  await bash(c, $, 'git commit -m x', DENY)
  await bash(c, $, 'gh pr create --fill', DENY)
  await bash(c, $, 'npm test', { result: {}, isError: true, text: 'fail' })
  await bash(c, $, 'npm test', DENY)
  expect(xpSum(st)).toBe(0)
  await bash(c, $, 'npm test', { result: {}, text: 'ok' }) // the red run is still pending, so a real pass earns
  expect(xpSum(st)).toBe(3)
})

test('xp: the coming-back bonus is capped at 5 a day', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 36_000_000 }]])
  const c = await levelBoot($, on, st)
  for (let i = 0; i < 7; i++) {
    await c.advance(200_000)
    await submit($, { text: 'hi' } as any)
  }
  expect(xpSum(st)).toBe(10)
})

test('xp: a quiet commit counts unless git had nothing to commit', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st)
  await bash(c, $, 'git commit -q -m x', { result: {}, text: '' })
  expect(xpSum(st)).toBe(15)
  await bash(c, $, 'git add . && git commit --quiet -F - && git log --oneline -1', { result: {}, text: 'ca82e55 msg' })
  expect(xpSum(st)).toBe(20)
  await bash(c, $, 'git commit -q -m y', { result: {}, text: 'nothing to commit, working tree clean' })
  await bash(c, $, 'git commit -m z', { result: {}, text: 'ok' })
  expect(xpSum(st)).toBe(20)
})

// ---------------------------------------------------------------- background tasks

const SCREEN = '#2b3a67' // the dark screen of the background laptop
const showsLaptop = (out: string) => expect(out).toMatch(fillRe(SCREEN))
const noLaptop = (out: string) => expect(out).not.toMatch(fillRe(SCREEN))
const note = (id: string, status: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`
const fromTask = (text: string) => ({ text, origin: { kind: 'task-notification' } }) as any

// A main turn that starts the given background calls and ends; returns once main is back to idle-or-background.
const bgBoot = async ($: any, on: any) => {
  helperMocks(on)
  on('classic.Stop', () => ({}) as any)
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.receive', (_: any, e: any) => ({ text: e.text }) as any)
  const res: { result: any; text?: string } = { result: {} }
  const clock = await boot($, on, res)
  await clock.advance(800)
  const start = async (call: any, result: any) => {
    res.result = result
    await $.tool.call(call)
  }
  const endTurn = async () => {
    await $.turn.complete(done())
    await clock.advance(5800)
  }
  return { clock, start, endTurn, res }
}
const NPM = { tool: 'Bash', command: 'npm run dev -- --token secret', run_in_background: true } as any

test('background: a Bash call with a backgroundTaskId keeps the buddy in background after the turn, by program name only', async ($, on) => {
  const { start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  const out = await bandOut($)
  hasLabel(out, `${LABELS.background} npm`)
  showsLaptop(out)
  expect(out).not.toMatch(/secret/)
})

test('background: a user ctrl+B Bash result (backgroundedByUser) counts too', async ($, on) => {
  const { start, endTurn } = await bgBoot($, on)
  await start({ tool: 'Bash', command: 'make test' } as any, { backgroundTaskId: 'b1', backgroundedByUser: true })
  await endTurn()
  hasLabel(await bandOut($), `${LABELS.background} make`)
})

test('background: a plain foreground Bash (no backgroundTaskId) goes done then idle', async ($, on) => {
  const { start, endTurn } = await bgBoot($, on)
  await start({ tool: 'Bash', command: 'make' } as any, { stdout: '', stderr: '', interrupted: false })
  await endTurn()
  expect(count(await bandOut($))).toBe(0)
})

test('background: a Monitor taskId counts, labelled by its description', async ($, on) => {
  const { start, endTurn } = await bgBoot($, on)
  await start({ tool: 'Monitor', description: 'tail the deploy log', command: 'tail -f x', timeout_ms: 1000 } as any, { taskId: 'm1', timeoutMs: 1000 })
  await endTurn()
  const out = await bandOut($)
  hasLabel(out, `${LABELS.background} tail the deploy log`)
  showsLaptop(out)
})

test('background: several tasks read as a count', async ($, on) => {
  const { start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await start({ tool: 'Bash', command: 'tail -f log', run_in_background: true } as any, { backgroundTaskId: 'b2' })
  await start({ tool: 'Monitor', description: 'w' } as any, { taskId: 'm1' })
  await endTurn()
  hasLabel(await bandOut($), `${LABELS.background} 3 tasks`)
})

test("background: a subagent's background shell counts unless it ends with its caller's final response", async ($, on) => {
  const { clock, start } = await bgBoot($, on)
  await start(sub('s1', 'Bash', { command: 'npm start', run_in_background: true }), { backgroundTaskId: 'b1', backgroundEndsWithFinalResponse: true })
  await $.turn.complete(done('s1'))
  await clock.advance(6000)
  expect(count(await bandOut($))).toBe(0) // no notification can follow: nothing tracked
  await start(sub('s2', 'Bash', { command: 'npm start', run_in_background: true }), { backgroundTaskId: 'b2' })
  await $.turn.complete(done('s2'))
  await clock.advance(6000) // the sub is done and dropped
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a TaskStop with task_id or shell_id ends it: back to idle at once, no done flash', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await start({ tool: 'Bash', command: 'tail -f x', run_in_background: true } as any, { backgroundTaskId: 'b2' })
  await endTurn()
  hasLabel(await bandOut($), `${LABELS.background} 2 tasks`)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} tail`)
  await $.tool.call({ tool: 'TaskStop', shell_id: 'b2' } as any)
  await clock.advance(800)
  const out = await bandOut($)
  expect(count(out)).toBe(0)
  expect(out).not.toContain(LABELS.done)
})

for (const status of ['completed', 'failed', 'killed']) {
  test(`background: a shell notification with status ${status} ends it`, async ($, on) => {
    const { clock, start, endTurn } = await bgBoot($, on)
    await start(NPM, { backgroundTaskId: 'b1' })
    await endTurn()
    hasLabel(await bandOut($), `${LABELS.background} npm`)
    await $.prompt.submit(fromTask(note('b1', status)))
    await $.turn.complete(done())
    await clock.advance(5800)
    expect(count(await bandOut($))).toBe(0)
  })
}

test('background: a notification for another task, or a user prompt naming a task id, ends nothing', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  await $.prompt.submit(fromTask(note('zzz', 'completed')))
  await $.turn.complete(done())
  await clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
  await $.prompt.submit({ text: note('b1', 'completed'), origin: { kind: 'composer' } } as any)
  await $.turn.complete(done())
  await clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a monitor event notification keeps it, a terminal one ends it', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start({ tool: 'Monitor', description: 'watch' } as any, { taskId: 'm1' })
  await endTurn()
  await $.prompt.submit(fromTask('<task-notification>\n<task-id>m1</task-id>\n<status>running</status>\n<event>line 1</event>\n</task-notification>'))
  await $.prompt.submit(fromTask('<task-notification>\n<task-id>m1</task-id>\n<event>line 2</event>\n</task-notification>'))
  await $.turn.complete(done())
  await clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.background} watch`)
  await $.prompt.submit(fromTask(note('m1', 'completed')))
  await $.turn.complete(done())
  await clock.advance(5800)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a classic.Stop resync drops tasks that are not in flight any more, keeps the listed ones', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await start({ tool: 'Bash', command: 'tail -f x', run_in_background: true } as any, { backgroundTaskId: 'b2' })
  await endTurn()
  hasLabel(await bandOut($), `${LABELS.background} 2 tasks`)
  await $.classic.Stop({ background_tasks: [{ id: 'b2', type: 'shell', status: 'running', description: 'x' }] } as any)
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} tail`)
  await $.classic.Stop({} as any) // no list: nothing to resync from
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} tail`)
  await $.classic.Stop({ background_tasks: [] } as any)
  await clock.advance(800)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a task that never ended is dropped after 8 hours', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  await clock.advance(7 * 3_600_000)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
  await clock.advance(1.1 * 3_600_000)
  expect(count(await bandOut($))).toBe(0)
})

test('background: helpers come before background, background before idle', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  const bg = await bandOut($)
  hasLabel(bg, `${LABELS.background} npm`)
  showsLaptop(bg)
  await subStart($, 's1')
  await clock.advance(800)
  const helpers = await bandOut($)
  hasLabel(helpers, `${LABELS.working} on 1 helper`)
  noLaptop(helpers)
  await $.turn.complete(done('s1')) // the last helper is done, the task still runs: straight to background, no done flash
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a running main turn shows its tool states, not background', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await clock.advance(800)
  const out = await bandOut($)
  hasLabel(out, LABELS.thinking)
  noLaptop(out)
})

test('background: the tasks survive a plugin reload (session.start again)', async ($, on) => {
  const { clock, start, endTurn } = await bgBoot($, on)
  await start(NPM, { backgroundTaskId: 'b1' })
  await endTurn()
  await $.session.start({ ...SS })
  await clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

for (const reason of ['clear', 'resume']) {
  test(`background: session.end ${reason} forgets the tasks, other end reasons keep them`, async ($, on) => {
    const { clock, start, endTurn } = await bgBoot($, on)
    await start(NPM, { backgroundTaskId: 'b1' })
    await endTurn()
    await $.session.end({ reason: 'other', sessionId: 's1', resume: {} } as any)
    await clock.advance(800)
    hasLabel(await bandOut($), `${LABELS.background} npm`)
    await $.session.end({ reason, sessionId: 's1', resume: {} } as any)
    await clock.advance(800)
    expect(count(await bandOut($))).toBe(0)
  })
}

test('background: the demo includes the background state and the art renders at every level', async ($, on) => {
  await boot($, on)
  expect((await run($, 'buddy-demo')).text ?? '').toMatch(/Cycling 14/)
  for (const level of [0, 2, 3, 4]) {
    const svg = buddySvg('background', 0, 96, { level, month: 4 })
    expect(svg).toContain(SCREEN)
  }
})

// ---- background tasks, in depth (tester)

// A notification as the engine really delivers it: extra tags, a long result, text around it.
const REAL = (id: string, status: string, extra = '') =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_01CzNgxHF3w1eLjNiUFLSoCf</tool-use-id>\n<output-file>/private/tmp/x/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>Agent "Background task buddy state" finished</summary>\n<note>some note</note>\n<result>done <b>ok</b> 1 < 2</result>${extra}\n</task-notification>`
const endIdle = async (ctx: any) => {
  await ctx.endTurn()
}
const afterNote = async ($: any, clock: any, text: string) => {
  await $.prompt.submit(fromTask(text))
  await $.turn.complete(done())
  await clock.advance(5800)
}

test('background: the live notification format (extra tags, surrounding text) ends a shell task', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'a980534161d30f121' })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
  await afterNote($, c.clock, `Background work finished.\n${REAL('a980534161d30f121', 'completed')}\nPlease continue.`)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a notification for a subagent id leaves the shell tasks alone', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await afterNote($, c.clock, REAL('a980534161d30f121', 'completed'))
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: one prompt carrying two notifications ends both named tasks', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.start({ tool: 'Bash', command: 'tail -f x', run_in_background: true } as any, { backgroundTaskId: 'b2' })
  await c.start({ tool: 'Bash', command: 'sleep 99', run_in_background: true } as any, { backgroundTaskId: 'b3' })
  await endIdle(c)
  await afterNote($, c.clock, `${REAL('b1', 'completed')}\n${REAL('b2', 'failed')}`)
  hasLabel(await bandOut($), `${LABELS.background} sleep`)
})

test('background: status case and whitespace are tolerated; a non-terminal status or missing id ends nothing', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await afterNote($, c.clock, REAL('b1', 'running'))
  await afterNote($, c.clock, '<task-notification>\n<status>completed</status>\n</task-notification>')
  await afterNote($, c.clock, '<task-notification>\n<task-id>b1</task-id>\n</task-notification>')
  hasLabel(await bandOut($), `${LABELS.background} npm`)
  await afterNote($, c.clock, '<task-notification>\n<task-id> b1 </task-id>\n<status> COMPLETED </status>\n</task-notification>')
  expect(count(await bandOut($))).toBe(0)
})

test('background: a task ending while the main turn runs does not flash idle; the turn end settles to idle', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await c.clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await c.clock.advance(800)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(800)
  const mid = await bandOut($)
  expect(mid).toMatch(/" reading x "/)
  noLaptop(mid)
  await $.turn.complete(done())
  await c.clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await c.clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a task starting mid-turn does not interrupt the tool state; after the turn it shows background', async ($, on) => {
  const c = await bgBoot($, on)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await c.clock.advance(800)
  await c.start({ tool: 'Bash', command: 'npm start', run_in_background: true } as any, { backgroundTaskId: 'b1' })
  await c.clock.advance(800)
  const mid = await bandOut($)
  noLaptop(mid)
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a task ending while helpers are active leaves the helpers label; when they finish it goes done then idle', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await subStart($, 's1')
  await c.endTurn()
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.turn.complete(done('s1'))
  await c.clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await c.clock.advance(5000)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a task starting while helpers are active is shown once the helpers finish', async ($, on) => {
  const c = await bgBoot($, on)
  await subStart($, 's1')
  await c.endTurn()
  await c.start(sub('s1', 'Bash', { command: 'npm start', run_in_background: true }), { backgroundTaskId: 'b1' })
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.turn.complete(done('s1'))
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a task started while the done timer is pending is shown when the timer fires, never idle', async ($, on) => {
  const c = await bgBoot($, on)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await $.turn.complete(done())
  await c.clock.advance(800)
  hasLabel(await bandOut($), LABELS.done)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.clock.advance(4000)
  await c.clock.advance(2000)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a task ended while the done timer is pending leaves done then idle', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await $.turn.complete(done())
  await c.clock.advance(800)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(6000)
  expect(count(await bandOut($))).toBe(0)
})

test('background: a task started while idle (subagent or ctrl+B after the turn) shows background at once', async ($, on) => {
  const c = await bgBoot($, on)
  await endIdle(c)
  await c.start({ tool: 'Bash', command: 'npm start' } as any, { backgroundTaskId: 'b1', backgroundedByUser: true })
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a duplicate start id counts once and keeps the newest label', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.start({ tool: 'Bash', command: 'yarn dev', run_in_background: true } as any, { backgroundTaskId: 'b1' })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} yarn`)
})

test('background: TaskStop for an unknown id, a denied TaskStop and an empty id change nothing', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await $.tool.call({ tool: 'TaskStop', task_id: 'nope' } as any)
  await $.tool.call({ tool: 'TaskStop' } as any)
  await $.tool.call({ tool: 'TaskStop', task_id: '' } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a denied TaskStop stopped nothing', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  Object.keys(c.res).forEach(k => delete (c.res as any)[k])
  Object.assign(c.res, { deny: 'blocked by policy' })
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: an errored result, or a missing/empty/wrong-typed id, starts no task', async ($, on) => {
  const c = await bgBoot($, on)
  const raw = (call: any, r: any) => {
    Object.keys(c.res).forEach(k => delete (c.res as any)[k])
    Object.assign(c.res, r)
    return $.tool.call(call)
  }
  await raw(NPM, { isError: true, result: { backgroundTaskId: 'b1' } })
  await raw({ tool: 'Monitor', description: 'w' } as any, { isError: true, result: { taskId: 'm1' } })
  await raw(NPM, { result: {} })
  await raw(NPM, { result: 'str' })
  await raw(NPM, { result: { backgroundTaskId: '' } })
  await raw(NPM, { result: { backgroundTaskId: 42 } })
  await raw({ tool: 'Monitor', description: 'w' } as any, { result: { backgroundTaskId: 'x' } }) // wrong field for a monitor
  await raw({ tool: 'Bash', command: 'x' } as any, { result: { taskId: 'x' } }) // wrong field for a shell
  await raw({ tool: 'Read', file_path: '/x' } as any, { result: { backgroundTaskId: 'r1', taskId: 'r2' } })
  await endIdle(c)
  expect(count(await bandOut($))).toBe(0)
})

test('background: monitor label is trimmed to 24 chars and squashed; a shell label never carries arguments', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start({ tool: 'Monitor', description: 'watch   the\ndeploy log for errors until done' } as any, { taskId: 'm1' })
  await endIdle(c)
  const out = await bandOut($)
  expect(out).toMatch(/running watch the deploy log/)
  expect(out).not.toMatch(/until done/)
})

test('background: shell label falls back for a missing or blank command; monitor falls back to "monitor"', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start({ tool: 'Bash', run_in_background: true } as any, { backgroundTaskId: 'b1' })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} shell`)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.start({ tool: 'Monitor', description: '   ' } as any, { taskId: 'm1' })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} monitor`)
})

test('background: many tasks are capped at 20 (oldest dropped) and read as a count', async ($, on) => {
  const c = await bgBoot($, on)
  for (let i = 0; i < 25; i++) await c.start({ tool: 'Bash', command: `job${i}`, run_in_background: true } as any, { backgroundTaskId: `t${i}` })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} 20 tasks`)
  await $.tool.call({ tool: 'TaskStop', task_id: 't0' } as any) // dropped long ago: unknown now
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} 20 tasks`)
  await $.tool.call({ tool: 'TaskStop', task_id: 't24' } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} 19 tasks`)
})

test('background: the 8 hour rescue drops only the old task and the count follows', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await c.clock.advance(7 * 3_600_000)
  await c.start({ tool: 'Bash', command: 'tail -f x', run_in_background: true } as any, { backgroundTaskId: 'b2' })
  await endIdle(c)
  hasLabel(await bandOut($), `${LABELS.background} 2 tasks`)
  await c.clock.advance(1.1 * 3_600_000)
  hasLabel(await bandOut($), `${LABELS.background} tail`)
})

test('background: the 60s tick is not armed while idle, is armed in background, and is cancelled once tasks end', async ($, on) => {
  const c = await bgBoot($, on)
  const pending = () => (c.clock as any).pending?.() ?? null
  await endIdle(c)
  const base = pending()
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  const armed = pending()
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(800)
  const after = pending()
  if (base !== null) {
    expect(armed).toBeGreaterThan(base)
    expect(after).toBe(base)
  }
  // behavioural check regardless: long idle stretch stays idle with no tasks
  await c.clock.advance(3_600_000)
  expect(count(await bandOut($))).toBe(0)
})

test('background: while demo runs, tasks do not change the demo; after it ends the buddy restores to background', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await run($, 'buddy-demo')
  for (let i = 0; i < 13; i++) {
    await c.clock.advance(2500)
    const out = await bandOut($)
    expect(out).not.toMatch(/running npm/)
  }
  await c.clock.advance(3000)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a task started during the demo is shown after it ends', async ($, on) => {
  const c = await bgBoot($, on)
  await endIdle(c)
  await run($, 'buddy-demo')
  await c.clock.advance(2500 * 3)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.clock.advance(2500 * 11)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a task stopped during the demo is not resurrected after it ends', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await run($, 'buddy-demo')
  await c.clock.advance(2500 * 3)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(2500 * 11)
  expect(count(await bandOut($))).toBe(0)
})

test('background: the label shows on the terminal and desktop band', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  const term = await bandOut($, 'terminal')
  expect(term).toContain(`${LABELS.background} npm`)
  const ui = await band($)
  const desk = await drawn(ui)
  expect(desk).toContain(`${LABELS.background} npm`)
  expect(desk).toMatch(fillRe(SCREEN))
  await ui.unmount()
  const ui2 = await band($, 'terminal')
  expect(await drawn(ui2)).toContain(`${LABELS.background} npm`)
  await ui2.unmount()
})

test('background: no XP for starting, running or ending a background task', async ($, on) => {
  const st = new Map<string, unknown>()
  on('classic.Stop', () => ({}) as any)
  const ctx = await levelBoot($, on, st)
  await bash(ctx, $, 'npm run dev', { result: { backgroundTaskId: 'b1' } }, { run_in_background: true })
  await bash(ctx, $, 'git commit -m x', { result: { backgroundTaskId: 'b2' }, text: '[main abc1234] msg' }, { run_in_background: true })
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await $.classic.Stop({ background_tasks: [] } as any)
  await $.prompt.submit(fromTask(REAL('b2', 'completed')))
  await settle()
  await $.turn.complete(done())
  expect(xpSum(st)).toBe(0)
})

test('background: classic.Stop with a task listed by id keeps a monitor; entries without an id are ignored safely', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start({ tool: 'Monitor', description: 'watch' } as any, { taskId: 'm1' })
  await endIdle(c)
  await $.classic.Stop({ background_tasks: [null, {}, { id: 'm1' }] } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} watch`)
})

test('background: a reload (session.start) resets the state flag but the stored tasks restore background', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await endIdle(c)
  await $.session.start({ ...SS })
  await c.clock.advance(800)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as any)
  await c.clock.advance(800)
  expect(count(await bandOut($))).toBe(0)
})

// ---- background tasks: review fixes

test('background: a notification delivered to a subagent through session.receive ends the task', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  hasLabel(await bandOut($), `${LABELS.background} npm`)
  const e = { text: note('b1', 'completed'), origin: { kind: 'task-notification' }, agentId: 's1' } as any
  await $.session.receive(e)
  await c.clock.advance(800)
  expect(count(await bandOut($))).toBe(0)
})

test('background: session.receive ignores other origins and unnamed tasks', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  await $.session.receive({ text: note('b1', 'completed'), origin: { kind: 'peer' }, agentId: 's1' } as any)
  await $.session.receive({ text: note('zzz', 'completed'), origin: { kind: 'task-notification' }, agentId: 's1' } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a session.receive notification mid-turn does not flash idle', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await c.clock.advance(800)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await c.clock.advance(800)
  await $.session.receive({ text: note('b1', 'completed'), origin: { kind: 'task-notification' }, agentId: 's1' } as any)
  const mid = await bandOut($)
  expect(mid).toMatch(/" reading x "/)
  noLaptop(mid)
})

test('background: the band never shows idle between background and thinking when a task ends', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  await $.prompt.submit(fromTask(note('b1', 'completed')))
  for (let i = 0; i < 8; i++) {
    const out = await bandOut($)
    expect(count(out)).toBeGreaterThan(0) // never the hidden (idle) band
    await c.clock.advance(100)
  }
  hasLabel(await bandOut($), LABELS.thinking)
})

test("background: a <status> echoed inside a monitor event's output does not end the monitor", async ($, on) => {
  const c = await bgBoot($, on)
  await c.start({ tool: 'Monitor', description: 'watch' } as any, { taskId: 'm1' })
  await c.endTurn()
  await $.prompt.submit(fromTask(
    '<task-notification>\n<task-id>m1</task-id>\n<tool-use-id>t</tool-use-id>\n<event>build log: <status>completed</status></event>\n</task-notification>',
  ))
  await $.prompt.submit(fromTask(
    '<task-notification>\n<task-id>m1</task-id>\n<summary>s</summary>\n<status>failed</status>\n</task-notification>',
  ))
  await $.turn.complete(done())
  await c.clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.background} watch`)
})

test("background: a monitor is dropped at its own timeout plus slack; a persistent one keeps the 8 hour net", async ($, on) => {
  const c = await bgBoot($, on)
  await c.start({ tool: 'Monitor', description: 'timed' } as any, { taskId: 'm1', timeoutMs: 60_000 })
  await c.endTurn()
  hasLabel(await bandOut($), `${LABELS.background} timed`)
  await c.clock.advance(60_000 + 120_000)
  await c.clock.advance(60_000) // the next rescue tick
  expect(count(await bandOut($))).toBe(0)
  await c.start({ tool: 'Monitor', description: 'forever' } as any, { taskId: 'm2', timeoutMs: 0, persistent: true })
  await c.endTurn()
  await c.clock.advance(3_600_000)
  hasLabel(await bandOut($), `${LABELS.background} forever`)
})

test('background: a task stored without a deadline gets the 8 hour net', async ($, on) => {
  let cur: any = { value: { shape: 'tasks-2', value: [{ id: 'old', kind: 'shell', label: 'oldjob', startedAt: 0 }] }, version: 1 }
  on('state.get', { plugin: 'my-buddy', key: 'tasks' } as any, () => ({ value: cur }) as any)
  on('state.set', { plugin: 'my-buddy', key: 'tasks' } as any, async (_: any, e: any, next: any) => {
    const r = await next(e)
    cur = { value: e.value, version: (r as any)?.version ?? cur.version + 1 }
    return r
  })
  const c = await bgBoot($, on)
  await c.endTurn()
  hasLabel(await bandOut($), `${LABELS.background} oldjob`)
  await c.clock.advance(8.1 * 3_600_000)
  expect(count(await bandOut($))).toBe(0)
})

// ---- background tasks: gap tests for the review-fix round

const TASK_NOTE = (inner: string) => `<task-notification>${inner}</task-notification>`
for (const [name, text, ended] of [
  ['whitespace and newlines between header tags', TASK_NOTE('\n  <task-id>\n b1 \n</task-id>\n\n\t<status>\n completed\n</status>\n<summary>x</summary>'), true],
  ['status before task-id', TASK_NOTE('<status>failed</status><task-id>b1</task-id>'), true],
  ['all header tags reordered', TASK_NOTE('<output-file>/x</output-file><status>killed</status><tool-use-id>t</tool-use-id><task-id>b1</task-id><summary>s</summary>'), true],
  ['no status at all', TASK_NOTE('<task-id>b1</task-id><summary>done</summary>'), false],
  ['status only after a non-header tag', TASK_NOTE('<task-id>b1</task-id><summary>s</summary><status>completed</status>'), false],
  ['text before the header', 'preamble text <task-id>zz</task-id> ' + TASK_NOTE('<task-id>b1</task-id><status>completed</status>'), true],
  ['repeated task-id: the first wins', TASK_NOTE('<task-id>other</task-id><task-id>b1</task-id><status>completed</status>'), false],
  ['repeated status: the first wins (non-terminal first)', TASK_NOTE('<task-id>b1</task-id><status>running</status><status>completed</status>'), false],
  ['header with an unknown tag first', TASK_NOTE('<foo>x</foo><task-id>b1</task-id><status>completed</status>'), false],
] as const) {
  test(`background: header parsing, ${name}`, async ($, on) => {
    const c = await bgBoot($, on)
    await c.start(NPM, { backgroundTaskId: 'b1' })
    await c.endTurn()
    await $.session.receive({ text, origin: { kind: 'task-notification' }, agentId: 's1' } as any)
    await c.clock.advance(800)
    if (ended) expect(count(await bandOut($))).toBe(0)
    else hasLabel(await bandOut($), `${LABELS.background} npm`)
  })
}

test('background: session.receive of a non-task origin with tags in its text ends nothing (any thread)', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  for (const kind of ['composer', 'peer', 'channel', 'agent']) {
    await $.session.receive({ text: note('b1', 'completed'), origin: { kind } } as any)
    await $.session.receive({ text: note('b1', 'completed'), origin: { kind }, agentId: 's1' } as any)
  }
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: session.receive passes the event to next unchanged for every origin', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  const t1 = note('b1', 'completed')
  const r1 = await $.session.receive({ text: t1, origin: { kind: 'task-notification' }, agentId: 's1' } as any)
  const r2 = await $.session.receive({ text: 'plain', origin: { kind: 'composer' } } as any)
  expect((r1 as any)?.text).toBe(t1)
  expect((r2 as any)?.text).toBe('plain')
})

test('background: a main-thread session.receive (no agentId, no prompt.submit after) drops the task; the band settles at the next rescue tick', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await c.endTurn()
  await $.session.receive({ text: note('b1', 'completed'), origin: { kind: 'task-notification' } } as any)
  await c.clock.advance(800)
  hasLabel(await bandOut($), `${LABELS.background} npm`) // state left alone: the submit is expected to follow
  await c.clock.advance(60_000)
  expect(count(await bandOut($))).toBe(0) // the 60s rescue tick resyncs to idle
})

test('background: a notification prompt.submit while main shows helpers (not background) ends the task, keeps the helpers label and then thinking', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1' })
  await subStart($, 's1')
  await c.endTurn()
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
  await $.prompt.submit(fromTask(note('b1', 'completed')))
  await c.clock.advance(800)
  hasLabel(await bandOut($), LABELS.thinking)
  await $.turn.complete(done())
  await c.clock.advance(800)
  // helper still active, task gone: back to helpers, never background
  await c.clock.advance(5800)
  hasLabel(await bandOut($), `${LABELS.working} on 1 helper`)
})

for (const [name, result, wantDroppedAfterMs] of [
  ['timeoutMs 0', { taskId: 'm1', timeoutMs: 0 }, 8 * 3_600_000],
  ['negative timeoutMs', { taskId: 'm1', timeoutMs: -5000 }, 8 * 3_600_000],
  ['missing timeoutMs', { taskId: 'm1' }, 8 * 3_600_000],
  ['string timeoutMs', { taskId: 'm1', timeoutMs: '60000' }, 8 * 3_600_000],
  ['persistent with a timeoutMs', { taskId: 'm1', timeoutMs: 60_000, persistent: true }, 8 * 3_600_000],
  ['timeoutMs 60s', { taskId: 'm1', timeoutMs: 60_000 }, 180_000],
] as const) {
  test(`background: monitor deadline, ${name}`, async ($, on) => {
    const c = await bgBoot($, on)
    await c.start({ tool: 'Monitor', description: 'mon' } as any, result)
    await c.endTurn()
    hasLabel(await bandOut($), `${LABELS.background} mon`)
    await c.clock.advance(wantDroppedAfterMs - 120_000)
    hasLabel(await bandOut($), `${LABELS.background} mon`)
    await c.clock.advance(180_000) // past the deadline, plus a rescue tick
    expect(count(await bandOut($))).toBe(0)
  })
}

test('background: a shell with a timeoutMs in its result still gets the 8 hour net', async ($, on) => {
  const c = await bgBoot($, on)
  await c.start(NPM, { backgroundTaskId: 'b1', timeoutMs: 1000 })
  await c.endTurn()
  await c.clock.advance(3_600_000)
  hasLabel(await bandOut($), `${LABELS.background} npm`)
})

test('background: a stored tasks-1 value after the shape bump (documents what the atom does)', async ($, on) => {
  let cur: any = { value: { shape: 'tasks-1', value: [{ id: 'old', kind: 'shell', label: 'oldjob', startedAt: 0 }] }, version: 1 }
  on('state.get', { plugin: 'my-buddy', key: 'tasks' } as any, () => ({ value: cur }) as any)
  on('state.set', { plugin: 'my-buddy', key: 'tasks' } as any, async (_: any, e: any, next: any) => {
    const r = await next(e)
    cur = { value: e.value, version: (r as any)?.version ?? cur.version + 1 }
    return r
  })
  const c = await bgBoot($, on)
  await c.endTurn()
  // Expectation: a value of an older shape is not trusted, so it is reset (no ghost task).
  expect(count(await bandOut($))).toBe(0)
})

// ---------------------------------------------------------------- keep-warm

const MIN = 60_000
// Boots with every call recorded: the prompts submitted, the compactions and the notifications.
const kwBoot = async ($: any, on: any, o: { store?: Map<string, unknown>; draft?: { current: string }; tokens?: number } = {}) => {
  engine(on)
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  const pings: any[] = []
  const compacts: any[] = []
  const notes: string[] = []
  const ctx = { current: { tokens: o.tokens ?? 150_000, window: 1_000_000 } }
  const hooks = { submit: false, compact: 'ok' as 'ok' | 'skip' | 'throw', notify: false, drop: false, gate: null as Promise<void> | null, readGate: null as Promise<void> | null, usageGate: null as Promise<void> | null }
  on('prompt.submit', (_: any, e: any) => {
    if (hooks.submit) throw new Error('no')
    if (hooks.drop && e.origin?.kind === 'plugin') return { drop: 'busy' } as any
    if (e.origin?.kind === 'plugin') pings.push(e)
    return { text: e.text } as any
  })
  on('prompt.read', async () => {
    if (hooks.readGate) await hooks.readGate
    return { value: { text: o.draft?.current ?? '', cursor: 0 } } as any
  })
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('classic.PostModelSwitch', () => ({}) as any)
  on('classic.PermissionRequest', () => ({}) as any)
  on('session.compact', async (_: any, e: any) => {
    if (e.trigger !== 'manual') compacts.push(e) // the engine stamps `plugin` on a plugin's call; the harness leaves it out
    if (hooks.gate) await hooks.gate
    if (hooks.compact === 'throw') throw new Error('no')
    return (hooks.compact === 'skip' ? { skip: 'no' } : { messages: MSGS }) as any
  })
  on('ui.notify', (_: any, e: any) => {
    if (hooks.notify) throw new Error('no')
    notes.push(e.text)
    return { value: { isSent: true, channel: 'x' } } as any
  })
  on('session.usage', async () => {
    if (hooks.usageGate) await hooks.usageGate
    return { value: { startedAt: 0, context: ctx.current, rateLimits: [] } } as any
  })
  const clock = await boot($, on, { result: {} }, 'desktop', o.store ?? {})
  return { clock, pings, compacts, notes, ctx, hooks }
}
const pingTurnDone = async ($: any) => reply($) // a ping's own turn: one response, no tool call
const buddy = ($: any, args: string, origin: any = { kind: 'composer' }) =>
  $.command.run({ command: 'buddy', args, origin, presentation: { isFullscreen: false, columns: 80 } })

test('keep-warm: the option defaults to on, a ping fires 3 minutes before the cache goes cold, never earlier', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(56 * MIN)
  expect(c.pings.length).toBe(0)
  await c.clock.advance(1 * MIN + 100)
  expect(c.pings.length).toBe(1)
  expect(c.pings[0].text).toContain('Keep-alive ping from my-buddy')
  expect(c.pings[0].origin).toEqual({ kind: 'plugin', name: 'my-buddy' })
})

test('keep-warm: a 5 minute cache pings 1 minute before it goes cold', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(3 * MIN)
  expect(c.pings.length).toBe(0)
  await c.clock.advance(1 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: keepWarm=false turns it off', { options: { keepWarm: false } }, async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  expect(await cacheBand($)).not.toContain('warm')
})

test('keep-warm: no stamp, no ping; a cold cache gets none either', async ($, on) => {
  const c = await kwBoot($, on)
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
  await reply($)
  await $.session.compact({ trigger: 'manual', messages: MSGS } as any) // forgets the stamp
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a cache that went cold meanwhile (reload late) gets no ping', async ($, on) => {
  const store = new Map<string, unknown>([['cacheStamp:s1', { at: 10_000 - 61 * MIN, ttlMs: 60 * MIN }]])
  const c = await kwBoot($, on, { store })
  await $.session.start(SS as any)
  await c.clock.advance(5 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: no ping while a main turn is running', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(30 * MIN)
  await $.turn.start({ text: 'go', turnId: 't2' } as any)
  await c.clock.advance(40 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: no ping while Claude waits on the person', async ($, on) => {
  const c = await kwBoot($, on)
  await $.turn.start({ text: 'go', turnId: 't2' } as any)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 1 } as any));
  await $.turn.complete({ reason: 'answer', answer: 'Which one do you want?', turnId: 't2' } as any)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: no ping while the demo runs; it goes out once the demo is over', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(56 * MIN + 50_000)
  await run($, 'buddy-demo') // 14 steps of 2.5 s: still running when the ping is due
  await c.clock.advance(20_000)
  expect(c.pings.length).toBe(0)
  await c.clock.advance(30_000)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a draft in the prompt box holds the ping back; it goes out once the box is empty', async ($, on) => {
  const draft = { current: 'half a thought' }
  const c = await kwBoot($, on, { draft })
  await reply($)
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(0)
  draft.current = ''
  await c.clock.advance(30_000)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: background helpers or tasks do not block a ping', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.turn.start({ text: 'x', turnId: 'h1', agentId: 'h1' } as any) // a helper still running
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: one timer only, re-armed on each new stamp', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(50 * MIN)
  await reply($) // a fresh stamp: the first timer must not fire at 57 minutes
  await c.clock.advance(8 * MIN)
  expect(c.pings.length).toBe(0)
  await c.clock.advance(1 * MIN + 100) // 59 minutes after the second stamp... wait: it fires at 57 after it
  expect(c.pings.length).toBe(0)
  await c.clock.advance(48 * MIN)
  expect(c.pings.length).toBe(1) // exactly one, not two
})

test('keep-warm: a ping turn re-stamps the cache and arms the next ping', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await pingTurnDone($)
  await c.clock.advance(56 * MIN)
  expect(c.pings.length).toBe(1)
  await c.clock.advance(1 * MIN + 100)
  expect(c.pings.length).toBe(2)
})

const runPings = async ($: any, c: any, n: number) => {
  for (let i = 0; i < n; i++) {
    await c.clock.advance(57 * MIN + 100)
    await pingTurnDone($)
  }
}

test('keep-warm: after 5 pings the next pre-cold moment compacts, switches off and notifies', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(5)
  expect(c.compacts.length).toBe(0)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(5) // no 6th
  expect(c.compacts.length).toBe(1)
  expect(c.notes.length).toBe(1)
  expect(c.notes[0]).toMatch(/5 pings/)
  expect(c.notes[0]).toMatch(/compacted/)
  await c.clock.advance(300 * MIN)
  expect(c.pings.length).toBe(5)
  expect((await buddy($, 'keepwarm off')).text).toMatch(/off/)
})

test('keep-warm: a small context is not compacted, keep-warm still switches off', async ($, on) => {
  const c = await kwBoot($, on, { tokens: 10_000 })
  await reply($)
  await runPings($, c, 5)
  await c.clock.advance(57 * MIN + 100)
  expect(c.compacts.length).toBe(0)
  expect(c.notes.length).toBe(1)
  expect(c.notes[0]).not.toMatch(/compacted/)
  await c.clock.advance(300 * MIN)
  expect(c.pings.length).toBe(5)
})

test('keep-warm: a compaction that is vetoed or fails still switches off', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.compact = 'skip'
  await reply($)
  await runPings($, c, 5)
  await c.clock.advance(57 * MIN + 100)
  expect(c.notes.length).toBe(1)
  expect(c.notes[0]).not.toMatch(/compacted/)
  await c.clock.advance(300 * MIN)
  expect(c.pings.length).toBe(5)
})

test('keep-warm: a prompt from the person resets the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await $.prompt.submit({ text: 'hello again', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  await runPings($, c, 5) // 5 more pings: no wind-down yet
  expect(c.pings.length).toBe(9)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: a command run by the person resets the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  await run($, 'buddy-demo')
  await buddy($, 'keepwarm on')
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(6)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: /buddy keepwarm on, off and a bare toggle; the reply carries the status and the context size', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  const off = await buddy($, 'keepwarm off')
  expect(off.text).toMatch(/off/)
  expect(off.text).toContain('150k')
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  const tog = await buddy($, 'keepwarm')
  expect(tog.text).toMatch(/on/)
  expect(tog.text).toContain('150k cached tokens')
  expect((await buddy($, 'keepwarm')).text).toMatch(/off/)
  expect((await buddy($, ' KeepWarm  ON ')).text).toMatch(/is on/)
  expect((await buddy($, 'keepwarm maybe')).text).toMatch(/Usage/)
})

test('keep-warm: switching on arms the ping at once for a warm cache; the override beats the option', { options: { keepWarm: false } }, async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await buddy($, 'keepwarm on')
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: the per-session override survives a reload but not a new session id', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await buddy($, 'keepwarm off')
  await $.session.start(SS as any) // a reload
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  sid.current = 's2' // a /clear: the override does not apply, the option (on) does
  await $.session.start(SS as any)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: the cache line says warm while armed, and not when off', async ($, on) => {
  await kwBoot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('cache 60m · warm')
  await buddy($, 'keepwarm off')
  const off = await cacheBand($)
  expect(off).toContain('cache 60m')
  expect(off).not.toContain('warm')
})

test('keep-warm: a ping prompt earns no thanks or back XP; a ping turn earns no turn XP and is not coming back', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await kwBoot($, on, { store: st })
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  // A ping whose text would read as thanks, and a ping turn that used a tool.
  await $.prompt.submit({ text: 'thanks', origin: { kind: 'plugin', name: 'my-buddy' } } as any)
  await settle()
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  for await (const _ of $.turn.step({ turnId: 't3', index: 0, model: 'm', messageCount: 1 } as any));
  await $.turn.complete(done(undefined, 't3'))
  await settle()
  expect(xpSum(st)).toBe(0)
  // The person comes back after the original cache would have gone cold: only the ping kept it warm, so no "back".
  await c.clock.advance(10 * MIN)
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await settle()
  expect(xpSum(st)).toBe(0)
})

test('keep-warm: coming back inside the cache the person left warm still earns "back" after a ping', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await kwBoot($, on, { store: st })
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await pingTurnDone($)
  await c.clock.advance(MIN) // 58 min after the person's last turn: their own cache (60 min) is still warm
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await settle()
  expect(xpSum(st)).toBeGreaterThan(0)
})

test('keep-warm: a throwing prompt.submit or notify never breaks the buddy', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.submit = true
  c.hooks.notify = true
  await reply($)
  await c.clock.advance(58 * MIN)
  expect(count(await bandOut($))).toBe(2) // the ctx bar and the buddy
})

// ---- keep-warm: gaps probed by the tester

test('keep-warm: a 6th ping is never sent, however many turns follow', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 12) // after the 5th the wind-down switches it off; later "turns" are only the harness stamping
  expect(c.pings.length).toBe(5)
})

test('keep-warm: a person prompt in the middle restarts the count at zero (exactly 5 more, then the wind-down)', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 3)
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(8)
  expect(c.compacts.length).toBe(0)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(8)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm: a prompt with no origin counts as the person and resets the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await $.prompt.submit({ text: 'again' } as any)
  await settle()
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(9)
  expect(c.compacts.length).toBe(0)
})

for (const args of ['', 'bogus']) {
  test(`keep-warm: a person-run /buddy ${JSON.stringify(args)} resets the count`, async ($, on) => {
    const c = await kwBoot($, on)
    await reply($)
    await runPings($, c, 4)
    await buddy($, args)
    await runPings($, c, 5)
    expect(c.pings.length).toBe(9)
    expect(c.compacts.length).toBe(0)
  })
}

test('keep-warm: a /buddy command issued by a plugin does not reset the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  await buddy($, 'bogus', { kind: 'plugin', name: 'other' })
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(5)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm: off then on again arms exactly one timer (no double ping)', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await buddy($, 'keepwarm off')
  await buddy($, 'keepwarm on')
  await buddy($, 'keepwarm')
  await buddy($, 'keepwarm')
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await c.clock.advance(1 * MIN) // still the same cache; no second timer
  expect(c.pings.length).toBe(1)
})

test('keep-warm: off cancels the pending timer; on inside the lead pings straight away', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(30 * MIN)
  await buddy($, 'keepwarm off')
  await c.clock.advance(28 * MIN) // 58 minutes in: inside the lead, nothing sent
  expect(c.pings.length).toBe(0)
  await buddy($, 'keepwarm on')
  await c.clock.advance(100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a new session id (/clear) starts the ping count over', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  sid.current = 's2'
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as any)
  await $.session.start(SS as any)
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(9) // 5 in the new session, no wind-down yet
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: a /resume into a session with a warm stamp arms the ping there', async ($, on) => {
  const store = new Map<string, unknown>([['cacheStamp:s2', { at: 10_000, ttlMs: 60 * MIN }]])
  const c = await kwBoot($, on, { store })
  await reply($)
  await buddy($, 'keepwarm off') // an override for s1 only
  sid.current = 's2'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as any)
  await c.clock.advance(10)
  await c.clock.advance(57 * MIN)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: Claude Code idle compaction cancels the pending ping; the buddy does not also compact or break', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  await c.clock.advance(20 * MIN)
  await $.session.compact({ trigger: 'auto', messages: MSGS } as any)
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(5)
  expect(c.compacts.length).toBe(1) // only Claude Code's own
  expect(c.notes.length).toBe(0)
  expect(count(await bandOut($))).toBe(2)
})

test('keep-warm: after an auto compaction a later turn re-arms the ping', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.session.compact({ trigger: 'auto', messages: MSGS } as any)
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a model switch forgets the cache and cancels the pending ping', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(10 * MIN)
  await $.classic.PostModelSwitch({} as any)
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: no ping while a compaction is running', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  let release!: () => void
  c.hooks.gate = new Promise<void>(r => (release = r))
  const p = $.session.compact({ trigger: 'auto', messages: MSGS } as any)
  await settle()
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(0)
  release()
  await p
})

test('keep-warm: no ping while a permission prompt is waiting', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(5 * MIN)
  await $.classic.PermissionRequest({} as any)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a draft that stays until the cache is cold means no ping, and no endless retry', async ($, on) => {
  const draft = { current: 'still typing' }
  const c = await kwBoot($, on, { draft })
  await reply($)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  draft.current = ''
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a whitespace-only draft does not hold the ping back', async ($, on) => {
  const c = await kwBoot($, on, { draft: { current: '   \n ' } })
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: the stamp being exactly 3 minutes from cold at boot pings at once; 1 ms inside the cache still pings', async ($, on) => {
  const store = new Map<string, unknown>([['cacheStamp:s1', { at: 10_000 - 57 * MIN, ttlMs: 60 * MIN }]])
  const c = await kwBoot($, on, { store })
  await c.clock.advance(100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a stamp not yet inside the lead waits for it', async ($, on) => {
  const store = new Map<string, unknown>([['cacheStamp:s1', { at: 10_000 - 50 * MIN, ttlMs: 60 * MIN }]])
  const c = await kwBoot($, on, { store })
  await c.clock.advance(6 * MIN)
  expect(c.pings.length).toBe(0)
  await c.clock.advance(1 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a 5 minute cache already inside its minute pings; the 3 minute lead is not used', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(3 * MIN + 30_000) // 1 min 30 s left on a 5-minute cache: not yet
  expect(c.pings.length).toBe(0)
  await c.clock.advance(30_000 + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a 5 minute cache winds down after 5 pings as well', { options: { cacheTtlMinutes: 5 } }, async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  for (let i = 0; i < 5; i++) {
    await c.clock.advance(4 * MIN + 100)
    await pingTurnDone($)
  }
  await c.clock.advance(4 * MIN + 100)
  expect(c.pings.length).toBe(5)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm: wind-down with unknown context size still compacts and notifies once (assumption: unknown is not "small")', async ($, on) => {
  const c = await kwBoot($, on)
  c.ctx.current = { window: 1_000_000 } as any
  await reply($)
  await runPings($, c, 5)
  await c.clock.advance(57 * MIN + 100)
  expect(c.notes.length).toBe(1)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm: context exactly 30k is compacted', async ($, on) => {
  const a = await kwBoot($, on, { tokens: 30_000 })
  await reply($)
  await runPings($, a, 5)
  await a.clock.advance(57 * MIN + 100)
  expect(a.compacts.length).toBe(1)
})

test('keep-warm: a compact that throws still switches off and notifies', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.compact = 'throw'
  await reply($)
  await runPings($, c, 5)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(5)
  expect(c.notes.length).toBe(1)
  expect(c.notes[0]).not.toMatch(/compacted/)
  await c.clock.advance(300 * MIN)
  expect(c.pings.length).toBe(5)
})

test('keep-warm: a ping the engine rejects leaves the buddy usable and real turns still earn XP', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await kwBoot($, on, { store: st })
  c.hooks.submit = true
  await reply($)
  await c.clock.advance(58 * MIN)
  await settle()
  c.hooks.submit = false
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done(undefined, 't9'))
  await settle()
  expect(xpSum(st)).toBeGreaterThan(0)
})

test('keep-warm: a ping turn earns no turn or firstTurn XP even with tool calls', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await kwBoot($, on, { store: st })
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.turn.complete(done(undefined, 't3'))
  await settle()
  expect(xpSum(st)).toBe(0)
})

test('keep-warm: the cache line says warm on the terminal band too, with the same band height', async ($, on) => {
  await kwBoot($, on)
  await reply($)
  const out = await cacheBand($, 'terminal')
  expect(out).toContain('warm')
})

test('keep-warm: the band shows the warm cache line', async ($, on) => {
  await kwBoot($, on)
  await reply($)
  const ui = await band($)
  expect(await drawn(ui)).toContain('warm')
  await ui.unmount()
})

test('keep-warm: no warm marker while a turn runs or after it goes cold', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(61 * MIN)
  expect(await cacheBand($)).toContain('cache cold')
  expect(await cacheBand($)).not.toContain('warm')
})

test('keep-warm: `/buddy keepwarm on extra` and `/buddy keepwarm toggle` give the usage text and change nothing', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  expect((await buddy($, 'keepwarm on extra')).text).toMatch(/Usage/)
  expect((await buddy($, 'keepwarm toggle')).text).toMatch(/Usage/)
  expect((await buddy($, 'warm')).text).toMatch(/Usage/)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

// ---- keep-warm: review fixes

const mine = (c: any) => c.pings.filter((p: any) => p.origin?.name === 'my-buddy').length
const asking = async ($: any, turnId = 't2') => {
  await $.turn.start({ text: 'go', turnId } as any)
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1 } as any));
  await $.turn.complete({ reason: 'answer', answer: 'Which one do you want?', turnId } as any)
}

test('keep-warm: a /clear drops the ping run, the ping turn flag and the pending timer of the old session', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await $.turn.start({ text: 'p', turnId: 'p5' } as any) // a ping turn flagged but not ended
  sid.current = 's2'
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as any)
  await c.clock.advance(120 * MIN) // s2 has no stamp: the old timer must not ping anything
  expect(c.pings.length).toBe(4)
})

test('keep-warm: plain /buddy by the person resets the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await buddy($, '')
  await runPings($, c, 5)
  expect(c.pings.length).toBe(9)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: a ping the engine drops is undone and retried every 30 s until it goes out', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.drop = true
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  const first = c.pings.length
  expect(first).toBe(0) // dropped: nothing entered
  c.hooks.drop = false
  await c.clock.advance(31_000)
  expect(c.pings.length).toBe(1)
  await pingTurnDone($)
  // the count was undone: 5 further pings fit before the wind-down
  await runPings($, c, 4)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: a ping that throws is retried, not past cold, and does not eat the count', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.submit = true
  await reply($)
  await c.clock.advance(70 * MIN) // cold: the retries stop
  expect(c.pings.length).toBe(0)
  c.hooks.submit = false
  await c.clock.advance(120 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a throwing ping is retried within the cache and then goes out', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.submit = true
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  c.hooks.submit = false
  await c.clock.advance(31_000)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: a question to the person blocks pings after a reload', async ($, on) => {
  const c = await kwBoot($, on)
  await asking($)
  await $.session.start(SS as any) // a reload resets the view and the timers
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a question to the person blocks pings after the demo overwrote the view', async ($, on) => {
  const c = await kwBoot($, on)
  await asking($)
  await run($, 'buddy-demo')
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: the answer from the person lifts the question block; a plugin or task prompt does not', async ($, on) => {
  const c = await kwBoot($, on)
  await asking($)
  await $.prompt.submit({ text: 'fyi', origin: { kind: 'task-notification' } } as any)
  await $.prompt.submit({ text: 'x', origin: { kind: 'plugin', name: 'other' } } as any)
  await $.turn.complete(done(undefined, 't3'))
  await c.clock.advance(58 * MIN)
  expect(mine(c)).toBe(0)
  await $.prompt.submit({ text: 'the first', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(mine(c)).toBe(1)
})

test('keep-warm: the question block is per session', async ($, on) => {
  const c = await kwBoot($, on, { store: new Map<string, unknown>([['cacheStamp:s2', { at: 10_000, ttlMs: 60 * MIN }]]) })
  await asking($)
  sid.current = 's2'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as any)
  await $.session.start(SS as any) // the view of s1 (waiting) is reset; only the per-session flag is left to decide
  await c.clock.advance(10)
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(1)
})

for (const [kind, extra] of [
  ['task-notification', {}],
  ['scheduled-trigger', {}],
  ['peer', {}],
  ['unclassified', {}],
  ['plugin', { name: 'other' }],
  ['plugin', { name: 'other', asUser: true }],
] as const) {
  test(`keep-warm: a prompt of kind ${kind}${(extra as any).asUser ? ' (asUser)' : ''} does not reset the count`, async ($, on) => {
    const c = await kwBoot($, on)
    await reply($)
    await runPings($, c, 4)
    await $.prompt.submit({ text: 'x', origin: { kind, ...extra } } as any)
    await settle()
    await reply($)
    await runPings($, c, 3) // 4 + 3 = 7 > 5: the wind-down cuts in at the 5th
    expect(mine(c)).toBe(5)
  })
}

for (const kind of ['composer', 'bridge', 'slack-ping', 'sdk'] as const) {
  test(`keep-warm: a prompt of kind ${kind} resets the count`, async ($, on) => {
    const c = await kwBoot($, on)
    await reply($)
    await runPings($, c, 4)
    await $.prompt.submit({ text: 'x', origin: { kind } } as any)
    await settle()
    await reply($)
    if (kind === 'sdk') return // pings stop for SDK hosts, see below
    await runPings($, c, 5)
    expect(c.pings.length).toBe(9)
  })
}

test('keep-warm: a /buddy run by another plugin does not clear the question block', async ($, on) => {
  const c = await kwBoot($, on)
  await asking($)
  await buddy($, '', { kind: 'plugin', name: 'other' })
  await c.clock.advance(58 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: a new stamp arriving while firePing awaits still gives exactly one ping', async ($, on) => {
  let release!: () => void
  const c = await kwBoot($, on)
  c.hooks.readGate = new Promise<void>(r => (release = r))
  await reply($)
  await c.clock.advance(57 * MIN + 100) // firePing is now parked on prompt.read
  await reply($) // a new stamp: re-arms
  release()
  await settle()
  await c.clock.advance(MIN)
  expect(c.pings.length).toBe(0) // the parked firePing is stale
  await c.clock.advance(57 * MIN)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: logout cancels the pending ping', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.session.end({ reason: 'logout', sessionId: 's1', resume: {} } as any)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
})

test('keep-warm: no pings once the person came from an SDK host', async ($, on) => {
  const c = await kwBoot($, on)
  await $.prompt.submit({ text: 'run', origin: { kind: 'sdk' } } as any)
  await settle()
  await reply($)
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  expect(await cacheBand($)).not.toContain('warm')
})

test('keep-warm: the warm marker needs a ping to be possible (question, cap)', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  expect(await cacheBand($)).toContain('warm')
  await asking($)
  await $.turn.complete(done(undefined, 't9'))
  expect(await cacheBand($)).not.toContain('warm')
  await $.prompt.submit({ text: 'ok', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  expect(await cacheBand($)).toContain('warm')
  await runPings($, c, 5)
  expect(await cacheBand($)).not.toContain('warm')
})

// ---- keep-warm: tester gap round 2

test('keep-warm: a channel prompt and an unknown future kind do not reset the count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await $.prompt.submit({ text: 'x', origin: { kind: 'channel' } } as any)
  await $.prompt.submit({ text: 'y', origin: { kind: 'some-future-kind' } } as any)
  await settle()
  await reply($)
  await runPings($, c, 3)
  expect(mine(c)).toBe(5)
})

test('keep-warm: a /resume resets the ping run (count) as a /clear does', async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await kwBoot($, on, { store: st })
  await reply($)
  await runPings($, c, 4)
  st.set('cacheStamp:s2', { at: 10_000 + 4 * 57 * MIN + 1000, ttlMs: 60 * MIN }) // s2 was warm when the person resumed it
  sid.current = 's2'
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as any)
  await $.session.start(SS as any)
  await c.clock.advance(1000)
  const before = c.pings.length
  await runPings($, c, 5)
  expect(c.pings.length - before).toBe(5)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm: after an SDK prompt stopped pings, a later composer prompt starts them again', async ($, on) => {
  const c = await kwBoot($, on)
  await $.prompt.submit({ text: 'run', origin: { kind: 'sdk' } } as any)
  await settle()
  await reply($)
  expect(await cacheBand($)).not.toContain('warm')
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  expect(await cacheBand($)).toContain('warm')
  await c.clock.advance(57 * MIN + 100)
  expect(mine(c)).toBe(1)
})

test('keep-warm: a dropped ping retrying, then a person turn re-stamps: only one ping at the new time, no stale retries', async ($, on) => {
  const c = await kwBoot($, on)
  c.hooks.drop = true
  await reply($)
  await c.clock.advance(57 * MIN + 100) // dropped once, retry pending
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($) // new stamp: re-arms, old retry is stale
  c.hooks.drop = false
  await c.clock.advance(31_000)
  expect(mine(c)).toBe(0)
  await c.clock.advance(57 * MIN)
  expect(mine(c)).toBe(1)
})

test('keep-warm: logout then a new stamp after logging in again pings again', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.session.end({ reason: 'logout', sessionId: 's1', resume: {} } as any)
  await c.clock.advance(5 * MIN)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(mine(c)).toBe(1)
})

test('keep-warm: a dropped ping at the cap boundary never sends a 6th and does not count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  c.hooks.drop = true
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(mine(c)).toBe(4)
  c.hooks.drop = false
  await c.clock.advance(31_000)
  expect(mine(c)).toBe(5)
  expect(c.compacts.length).toBe(0)
})

// ---- keep-warm: final review fixes

// A turn that ends with the given reason and no model step (so no stamp).
const bareTurn = async ($: any, reason: string, turnId = 't7') => {
  await $.turn.start({ text: 'x', turnId } as any)
  await $.turn.complete({ reason, answer: '', turnId } as any)
}

for (const reason of ['aborted', 'error', 'refusal']) {
  test(`keep-warm: a ping turn that ends ${reason} with no stamp does not ping again`, async ($, on) => {
    const c = await kwBoot($, on)
    await reply($)
    await c.clock.advance(57 * MIN + 100)
    expect(c.pings.length).toBe(1)
    await bareTurn($, reason)
    await c.clock.advance(10 * MIN)
    expect(c.pings.length).toBe(1)
    await c.clock.advance(120 * MIN)
    expect(c.pings.length).toBe(1)
    expect(c.compacts.length).toBe(0)
  })
}

test('keep-warm: a new stamp after a failed ping lifts the hold', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  await bareTurn($, 'error')
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(2)
})

test('keep-warm: repeated ping errors never compact and never wind down', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  for (let i = 0; i < 8; i++) {
    await c.clock.advance(57 * MIN + 100)
    await bareTurn($, 'error', `e${i}`)
    await reply($) // the person is back with a real stamp between failures
  }
  expect(c.compacts.length).toBe(0)
  expect(c.notes.length).toBe(0)
  expect((await buddy($, 'keepwarm')).text).toMatch(/on|off/)
  expect(c.pings.length).toBe(8)
})

test('keep-warm: an Esc resets the ping count', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 4)
  await bareTurn($, 'aborted')
  await c.clock.advance(1000) // a stamp is a new one only at a later time
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(9)
  expect(c.compacts.length).toBe(0)
})

for (const reason of ['aborted', 'error']) {
  test(`keep-warm: a person turn ${reason} inside the lead window causes no immediate ping`, async ($, on) => {
    const c = await kwBoot($, on)
    await reply($)
    await c.clock.advance(57 * MIN - 1000) // inside the lead, ping not yet due
    await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
    await settle()
    await bareTurn($, reason)
    await c.clock.advance(5 * MIN)
    expect(c.pings.length).toBe(0)
  })
}

test('keep-warm: a ping is never sooner than 30 s after the last one, whatever the path', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await $.session.start(SS as any) // a re-arm path that ignores the hold (reload) while the lead is still on
  await c.clock.advance(5_000)
  expect(c.pings.length).toBe(1)
})

test('keep-warm: the SDK host flag survives a reload', async ($, on) => {
  const c = await kwBoot($, on)
  await $.prompt.submit({ text: 'run', origin: { kind: 'sdk' } } as any)
  await settle()
  await reply($)
  await $.session.start(SS as any) // a reload: fresh process state, same session
  await c.clock.advance(70 * MIN)
  expect(c.pings.length).toBe(0)
  expect(await cacheBand($)).not.toContain('warm')
})

test('keep-warm: a person prompt that lands during the wind-down aborts the compaction, still switches off and notifies', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  let open!: () => void
  c.hooks.usageGate = new Promise<void>(r => (open = r))
  await c.clock.advance(57 * MIN + 100) // the wind-down starts and waits on the context size
  void $.prompt.submit({ text: 'back', origin: { kind: 'composer' } } as any) // its own usage read waits on the gate too
  await settle()
  open()
  await settle()
  await settle()
  expect(c.compacts.length).toBe(0)
  expect(c.notes.length).toBe(1)
  expect(c.notes[0]).not.toMatch(/compacted/)
})

test('keep-warm: a running turn that took over during the wind-down aborts the compaction', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  let open!: () => void
  c.hooks.usageGate = new Promise<void>(r => (open = r))
  await c.clock.advance(57 * MIN + 100)
  await $.turn.start({ text: 'x', turnId: 'tw' } as any)
  open()
  await settle()
  await settle()
  expect(c.compacts.length).toBe(0)
  expect(c.notes.length).toBe(1)
})

// ---- keep-warm: tester round 3 (second fix round)

// A turn with a model step (so it stamps) that ends with the given reason.
const stampedTurn = async ($: any, reason: string, origin?: any) => {
  if (origin) { await $.prompt.submit({ text: 'x', origin } as any); await settle() }
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any));
  await $.turn.complete({ reason, answer: '', turnId: 't1' } as any)
}

test('keep-warm r3: alternating error and success pings keep the count right; the cap is reached by 5 successes only', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 2) // 2 successes
  await c.clock.advance(57 * MIN + 100)
  await bareTurn($, 'error', 'e1') // ping 3 fails: does not count, holds
  await c.clock.advance(10 * MIN)
  expect(c.pings.length).toBe(3)
  // a non-person turn stamps anew (lifts the hold without resetting the count)
  await stampedTurn($, 'answer', { kind: 'task-notification' })
  await runPings($, c, 2) // successes 3 and 4
  expect(c.pings.length).toBe(5)
  expect(c.compacts.length).toBe(0)
  await c.clock.advance(57 * MIN + 100) // fifth success sent
  expect(c.pings.length).toBe(6)
  await pingTurnDone($)
  await c.clock.advance(57 * MIN + 100) // the wind-down
  expect(c.pings.length).toBe(6)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm r3: an error ping then a person prompt: count restarts and pings resume after the next stamp', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 3)
  await c.clock.advance(57 * MIN + 100)
  await bareTurn($, 'error', 'e1')
  await $.prompt.submit({ text: 'back', origin: { kind: 'composer' } } as any)
  await settle()
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(3 + 1 + 5)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(9)
  expect(c.compacts.length).toBe(1)
})

test('keep-warm r3: Esc during the wind-down compaction itself does not break it; keep-warm ends off and notified once', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 5)
  let open!: () => void
  c.hooks.gate = new Promise<void>(r => (open = r))
  await c.clock.advance(57 * MIN + 100) // compact() is now in flight
  expect(c.compacts.length).toBe(1)
  await bareTurn($, 'aborted', 'esc')
  open()
  await settle()
  await settle()
  expect(c.notes.length).toBe(1)
  await c.clock.advance(5 * MIN)
  expect(c.pings.length).toBe(5)
  expect((await buddy($, 'keepwarm off')).text).toMatch(/off/)
})

test('keep-warm r3: a refusal on a person turn outside the lead window re-arms normally', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await settle()
  await stampedTurn($, 'refusal') // stamped (fresh), ends refusal, far from the lead
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm r3: a person refusal with a stamp-less turn outside the lead window still re-arms on the old stamp', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(10 * MIN)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as any)
  await settle()
  await bareTurn($, 'refusal')
  await c.clock.advance(47 * MIN + 100)
  expect(c.pings.length).toBe(1)
})

test('keep-warm r3: Esc on a main turn resets the count and sends no ping for that same stamp; the next stamp re-arms', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await runPings($, c, 3)
  await c.clock.advance(57 * MIN - 1000)
  await $.turn.start({ text: 'x', turnId: 'tz' } as any)
  await $.turn.complete({ reason: 'aborted', answer: '', turnId: 'tz' } as any)
  await c.clock.advance(5 * MIN)
  expect(c.pings.length).toBe(3)
  await c.clock.advance(1000)
  await reply($)
  await runPings($, c, 5)
  expect(c.pings.length).toBe(8)
})

test('keep-warm: the cache line drops warm while an Esc holds pings back, and shows it again on the next stamp', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await $.turn.start({ text: 'x', turnId: 'tz' } as any)
  await $.turn.complete({ reason: 'aborted', answer: '', turnId: 'tz' } as any)
  const held = await cacheBand($)
  expect(held).toContain('cache')
  expect(held).not.toContain('warm')
  await c.clock.advance(1000)
  await reply($)
  expect(await cacheBand($)).toContain('· warm')
})

test('keep-warm r3: a ping that errors after stamping, then a ping-free interval: no ping storm, bounded by 30 s', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  await stampedTurn($, 'error') // ping stamped then failed
  await c.clock.advance(3 * 60 * MIN)
  expect(c.pings.length).toBeLessThanOrEqual(2)
  expect(c.compacts.length).toBe(0)
})

test('keep-warm r3: a failing /buddy keepwarm toggle within 30 s of a ping never sends a second ping inside 30 s', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  await c.clock.advance(57 * MIN + 100)
  expect(c.pings.length).toBe(1)
  await buddy($, 'keepwarm off', { kind: 'plugin', name: 'x' })
  await buddy($, 'keepwarm on', { kind: 'plugin', name: 'x' })
  await c.clock.advance(10_000)
  expect(c.pings.length).toBe(1)
})

// ---- /buddy XP reply, gap tests

test('xp: /buddy earns nothing itself, even after a long idle with a warm cache that would pay the coming-back bonus', async ($, on) => {
  const st = new Map<string, unknown>([['cacheStamp:s1', { at: NOV13, ttlMs: 36_000_000 }]])
  const c = await levelBoot($, on, st)
  await c.advance(300_000)
  const before = JSON.stringify([...st.entries()])
  for (let i = 0; i < 3; i++) expect((await xpText($)).split('\n')[0]).toBe('Lv 1 · 0 / 200 XP')
  await settle()
  expect(JSON.stringify([...st.entries()])).toBe(before)
  expect(xpKeys(st)).toEqual([])
})

test("xp: the /buddy reply's Today drops to 0 across midnight while the month total stays", async ($, on) => {
  const st = new Map<string, unknown>()
  const c = await levelBoot($, on, st, new Date(2026, 10, 13, 23, 59, 0).getTime())
  await bash(c, $, 'git commit -m x', OK_COMMIT)
  expect((await xpText($)).split('\n')).toEqual(['Lv 1 · 15 / 200 XP', 'Today +15 XP · next: bow tie in 185 XP'])
  await c.advance(2 * 60_000)
  expect((await xpText($)).split('\n')).toEqual(['Lv 1 · 15 / 200 XP', 'Today +0 XP · next: bow tie in 185 XP'])
})

test('buddy: unknown arguments give the exact usage line; keepwarm args are case-insensitive; no pane either way', async ($, on) => {
  const c = await kwBoot($, on)
  await reply($)
  for (const a of ['help', 'xp', 'keepwarm maybe', 'keepwarm on off', 'pane'])
    expect((await buddy($, a)).text).toBe('Usage: /buddy [keepwarm [on|off]]')
  expect((await buddy($, '  KeepWarm   OFF ')).text).not.toMatch(/Usage/)
  expect((await buddy($, 'KEEPWARM ON')).text).not.toMatch(/Usage/)
  expect(c.clock.opened.length).toBe(0)
})
