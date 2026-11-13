import type { BuddyLook, BuddyState } from '../types'

export const LABELS: Record<BuddyState, string> = {
  idle: 'idle', thinking: 'thinking...', reading: 'reading', searching: 'searching',
  editing: 'editing', running: 'running', browsing: 'browsing', spawning: 'spawning',
  waiting: 'waiting for you', error: 'oops', done: 'done!', compacting: 'compacting', working: 'working',
}
export const EMOJI: Record<BuddyState, string> = {
  idle: '(o.o)', thinking: '(o_o)...', reading: '(o.o)[=]', searching: '(o.o)?o', editing: '(o.o)#',
  running: '(>.<)*', browsing: '(o.o)8', spawning: '(o.o)~', waiting: '(o.o)?', error: "(T.T)", done: '(^.^)*', compacting: '(o.o)@', working: '(o.o)%',
}

const PALETTES = [
  { body: '#f4a7c0', hi: '#fbd3e0', cheek: '#ff7fa3' }, // main: pink
  { body: '#8ecae6', hi: '#c8e8f5', cheek: '#ffa8c0' }, // blue
  { body: '#a8e6a1', hi: '#d3f5cf', cheek: '#ff9fb4' }, // green
  { body: '#ffd166', hi: '#ffe8a8', cheek: '#ff8f70' }, // yellow
  { body: '#c3a6f0', hi: '#e1d3fa', cheek: '#ff8fbf' }, // violet
] as const
type Palette = { body: string; hi: string; cheek: string }

const C: Record<string, string> = {
  k: '#3b2a3a', w: '#ffffff', g: '#8d8d9b', G: '#6a6a80', y: '#ffd166', b: '#6bb5ff', B: '#3d85d8',
  r: '#ef476f', n: '#a0673b', t: '#d9a066', d: '#7a4a24', l: '#e8e8f0', f: '#f08fb0',
  R: '#b5223f', e: '#52b788', E: '#2d6a4f', o: '#ff9f1c', O: '#e07a00', m: '#ff8fab', u: '#2b3a67', i: '#ffe3b3',
}
const GOLD: Palette = { body: '#ffd54a', hi: '#fff0a0', cheek: '#ff9f5a' }
type Px = [number, number, string]
type Frame = { dx?: number; dy?: number; eyes?: string; mouth?: string; props?: Px[]; behind?: Px[] }
type Anim = { ms: number; frames: Frame[] }

// A sprite: rows of chars, '.' is empty; the legend is C unless overridden.
const spr = (rows: string[], ox: number, oy: number, keep: (x: number, y: number) => boolean = () => true): Px[] => {
  const out: Px[] = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.' && keep(x, y)) out.push([ox + x, oy + y, ch])
  }))
  return out
}
const dots = (ch: string, ...xy: [number, number][]): Px[] => xy.map(([x, y]) => [x, y, ch])

const BOOK = ['kkkkkkkkkk', 'kwwwBBwwwk', 'kwggBBwggk', 'kwwwBBwwwk', 'kkkkkkkkkk']
const MAG = ['.kkk.', 'kbbbk', 'kbwbk', 'kbbbk', '.kkk.']
const BINO = ['kkkk..kkkk', 'kBwk..kBwk', 'kBBkkkkBBk', 'kkkk..kkkk']
const BINO2 = ['kkkk..kkkk', 'kBBk..kBBk', 'kBwkkkkBwk', 'kkkk..kkkk']
const COOKIE = ['.ttt.', 'tdtdt', 'ttttt', 'tdttt', '.ttt.']
const QMARK = ['kkk', '..k', '.k.', '...', '.k.']
const bubble = (oy: number): Px[] => [
  ...spr(['.kkkkk.', 'kwwwwwk', 'kwwwwwk', 'kwwwwwk', 'kwwwwwk', 'kwwwwwk', '.kkkkk.'], 9, oy),
  ...spr(QMARK, 11, oy + 1), ...dots('k', [9, oy + 7]),
]
const GEAR_P = [[2, 0], [2, 1], [2, 3], [2, 4], [0, 2], [1, 2], [3, 2], [4, 2]]
const GEAR_X = [[0, 0], [1, 1], [3, 3], [4, 4], [4, 0], [3, 1], [1, 3], [0, 4]]
const gear = (pts: number[][], oy: number): Px[] => [
  ...pts.map(([x, y]): Px => [10 + x!, oy + y!, 'G']), [12, oy + 2, 'y'],
]
const puff = (r: number): Px[] => {
  const o: Px[] = []
  const add = (cx: number, cy: number) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) o.push([cx + x, cy + y, 'l'])
  }
  add(13, 8); add(2, 8)
  return o
}

const ANIMS: Record<BuddyState, Anim> = {
  idle: { ms: 450, frames: [{}, { dy: 1 }, { dy: 1, eyes: 'blink' }, {}] },
  thinking: {
    ms: 320, frames: [
      { eyes: 'up', mouth: 'flat', props: dots('g', [8, 1], [9, 1]) },
      { eyes: 'up', mouth: 'flat', props: [...dots('g', [8, 1], [9, 1], [11, 1], [12, 1])] },
      { eyes: 'up', mouth: 'flat', props: [...dots('g', [8, 1], [9, 1], [11, 1], [12, 1], [14, 1], [15, 1])] },
      { eyes: 'up', mouth: 'flat', props: [] },
    ],
  },
  reading: {
    ms: 380, frames: [
      { eyes: 'down', props: spr(BOOK, 3, 9) },
      { eyes: 'down', props: [...spr(BOOK, 3, 9), ...dots('w', [9, 8], [10, 8], [11, 8]), ...dots('k', [12, 8])] },
      { eyes: 'down', props: [...spr(BOOK, 3, 9), ...dots('w', [8, 8], [9, 8]), ...dots('k', [7, 8], [10, 8])] },
      { eyes: 'down', props: spr(BOOK.map(r => r.replace('gg', 'ww')), 3, 9) },
    ],
  },
  searching: {
    ms: 280, frames: [8, 9, 10, 9].map(ox => ({
      eyes: ox < 9 ? 'left' : 'right',
      props: [...spr(MAG, ox - 2, 6), ...dots('n', [ox + 3, 11], [ox + 4, 12])],
    })),
  },
  editing: {
    ms: 140, frames: [true, false, true, false].map((left, i): Frame => ({
      eyes: i % 2 ? 'blink' : 'down',
      props: [
        ...spr(['ff', 'ff'], 4, left ? 13 : 11), ...spr(['ff', 'ff'], 10, left ? 11 : 13),
        ...spr(['kkkkkkkkkkkk', 'kgwgwgwgwgwk'], 2, 14),
      ],
    })),
  },
  running: {
    ms: 170, frames: [
      { eyes: 'closed', mouth: 'flat', props: [...spr(['nn', 'nn'], 13, 4), ...spr(['GGGG', 'GGGG'], 11, 1), ...dots('b', [1, 3])] },
      { eyes: 'closed', mouth: 'flat', props: [...spr(['nn', 'nn'], 13, 6), ...spr(['GGGG', 'GGGG'], 11, 4), ...dots('b', [1, 4])] },
      { eyes: 'closed', mouth: 'flat', props: [...spr(['nn', 'nn'], 13, 10), ...spr(['GGGG', 'GGGG'], 11, 8), ...dots('y', [10, 13], [15, 12], [10, 10]), ...dots('b', [1, 5], [1, 6])] },
      { eyes: 'closed', mouth: 'flat', props: [...spr(['nn', 'nn'], 13, 7), ...spr(['GGGG', 'GGGG'], 11, 5), ...dots('y', [9, 12]), ...dots('b', [1, 7])] },
    ],
  },
  browsing: {
    ms: 300, frames: [
      { eyes: 'none', mouth: 'o', props: spr(BINO, 3, 8) },
      { eyes: 'none', mouth: 'o', props: spr(BINO2, 4, 8) },
      { eyes: 'none', mouth: 'o', props: spr(BINO, 5, 9) },
      { eyes: 'none', mouth: 'o', props: spr(BINO2, 4, 9) },
    ],
  },
  spawning: {
    ms: 200, frames: [
      { dy: 1, mouth: 'o', props: puff(0) },
      { dy: 0, mouth: 'o', props: puff(1) },
      { dy: -1, mouth: 'o', props: [...puff(2), ...dots('y', [0, 3], [15, 3])] },
      { dy: 0, mouth: 'o', props: dots('l', [0, 4], [15, 5], [1, 12], [14, 13], [0, 8], [15, 9]) },
    ],
  },
  waiting: {
    ms: 260, frames: [1, 0, 1, 2].map(oy => ({ eyes: 'up', mouth: 'o', props: bubble(oy) })),
  },
  error: {
    ms: 180, frames: [
      { dx: 0, eyes: 'closed', mouth: 'frown', props: dots('B', [5, 10], [10, 10]) },
      { dx: 1, eyes: 'closed', mouth: 'frown', props: dots('B', [5, 11], [10, 11], [5, 10], [10, 10]) },
      { dx: 0, eyes: 'closed', mouth: 'frown', props: dots('B', [5, 12], [10, 12], [5, 11], [10, 11]) },
      { dx: -1, eyes: 'closed', mouth: 'frown', props: dots('B', [5, 13], [10, 13], [5, 12], [10, 12]) },
    ],
  },
  done: {
    ms: 150, frames: [
      { eyes: 'happy', mouth: 'smile', props: dots('y', [13, 2], [12, 3], [14, 3], [13, 4]) },
      { dy: -2, eyes: 'happy', mouth: 'smile', props: dots('y', [2, 1], [1, 2], [3, 2], [2, 3]) },
      { dy: -3, eyes: 'happy', mouth: 'smile', props: dots('y', [13, 0], [12, 1], [14, 1], [13, 2], [2, 4]) },
      { dy: -1, eyes: 'happy', mouth: 'smile', props: dots('y', [2, 2], [14, 5]) },
    ],
  },
  compacting: {
    ms: 330, frames: [5, 4, 3, 2].map((cols, i): Frame => ({
      eyes: 'closed', mouth: i % 2 ? 'o' : 'flat',
      props: [
        ...spr(COOKIE, 6, 11, x => x < cols), ...dots('f', [5, 12], [5, 13], [11, 12], [11, 13]),
        ...(i ? dots('t', [8, 14 + (i % 2)], [7, 15]) : []),
      ],
    })),
  },
  working: {
    ms: 220, frames: [
      { dy: 0, props: gear(GEAR_P, 0) },
      { dy: 1, props: gear(GEAR_X, 0) },
    ],
  },
}

const row = (a: number, b: number, y: number): Px[] => {
  const o: Px[] = []
  for (let x = a; x <= b; x++) o.push([x, y, 'p'])
  return o
}

// The body: outline + fill, then face parts.
const bodyPx = (p: Palette, f: Frame): Px[] => {
  const out: Px[] = []
  const sil: [number, number, number][] = [ // y, outline left x, outline right x
    [5, 3, 12], [6, 2, 13], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 1, 14], [12, 2, 13], [13, 3, 12],
  ]
  for (let x = 4; x <= 11; x++) out.push([x, 4, 'k'], [x, 14, 'k'])
  for (const [y, l, r] of sil) {
    out.push([l, y, 'k'], [r, y, 'k'], ...row(l + 1, r - 1, y))
  }
  out.push([4, 6, 'h'], [5, 6, 'h'], [4, 7, 'h'], [12, 12, 's'])
  // eyes
  const e = f.eyes ?? 'open'
  const E = (x: number, y: number): Px => [x, y, 'k']
  const eyeSets: Record<string, Px[]> = {
    open: [E(5, 8), E(5, 9), E(10, 8), E(10, 9)],
    blink: [E(5, 9), E(6, 9), E(9, 9), E(10, 9)],
    happy: [E(4, 9), E(5, 8), E(6, 9), E(9, 9), E(10, 8), E(11, 9)],
    closed: [E(5, 9), E(6, 9), E(9, 9), E(10, 9)],
    up: [E(5, 7), E(5, 8), E(10, 7), E(10, 8)],
    down: [E(5, 9), E(5, 10), E(10, 9), E(10, 10)],
    left: [E(4, 8), E(4, 9), E(9, 8), E(9, 9)],
    right: [E(6, 8), E(6, 9), E(11, 8), E(11, 9)],
    none: [],
  }
  out.push(...(eyeSets[e] ?? eyeSets.open!))
  // cheeks
  out.push([3, 10, 'c'], [4, 10, 'c'], [11, 10, 'c'], [12, 10, 'c'])
  // mouth
  const m = f.mouth ?? 'dot'
  const mouths: Record<string, Px[]> = {
    dot: [[7, 11, 'k'], [8, 11, 'k']],
    flat: [[7, 11, 'k'], [8, 11, 'k']],
    o: [[7, 11, 'k'], [8, 11, 'k'], [7, 12, 'k'], [8, 12, 'k']],
    smile: [[6, 11, 'k'], [9, 11, 'k'], [7, 12, 'k'], [8, 12, 'k']],
    frown: [[7, 11, 'k'], [8, 11, 'k'], [6, 12, 'k'], [9, 12, 'k']],
  }
  out.push(...(mouths[m] ?? mouths.dot!))
  return out
}

// Accessories of the main buddy, on the same 16x16 grid and drawn over the body. A hat is rows of sprite chars whose
// last row lands on the head's top outline (y 4); ox is its left column.
const BOW: Px[] = [
  ...dots('r', [5, 12], [10, 12], [5, 14], [10, 14]), ...spr(['rrRRrr'], 5, 13),
]
const HATS: [number, string[]][] = [
  [4, ['...yy...', '...bb...', '..bwwb..', 'bbwbbwbb']], // Jan party hat
  [4, ['........', 'r.r..r.r', '.r....r.', 'mmmmmmmm']], // Feb heart headband
  [4, ['.ee..ee.', '..eeee..', '....E...', '....E...']], // Mar clover sprout
  [4, ['..yyyy..', '.ywyyyy.', 'yyyyyyyy', 'oooooooo']], // Apr rain hood
  [4, ['........', '.m..w.m.', 'EmEEwEmE', '........']], // May flower crown
  [4, ['........', '........', 'kkkkkkkk', 'kBBkkBBk']], // Jun sunglasses pushed up
  [4, ['..eEEe..', '.rryrrr.', '.rrrryr.', '..rRRr..']], // Jul strawberry
  [2, ['............', '....tttt....', '...trrrrt...', 'nnnnnnnnnnnn']], // Aug sun hat
  [2, ['...uuuuuu...', 'uuuuuuuuuuuy', '...uuuuuu..y', '...uuuuuu..y']], // Sep graduation cap
  [4, ['...ee...', '.oooooo.', 'ookookoo', 'oooooooo']], // Oct pumpkin hat
  [4, ['...ww...', '..bbbb..', '.bbbbbb.', 'BbBbBbBb']], // Nov knit beanie
  [4, ['......ww', '..rrrrr.', '.rrrrrr.', 'wwwwwwww']], // Dec snow cap
]
const SPARKS: Px[][] = [dots('o', [0, 2], [14, 1]), dots('o', [1, 12], [15, 4]), dots('o', [0, 7], [14, 13]), dots('o', [15, 9], [1, 3])]

const accessories = (look: BuddyLook, f: Frame): Px[] => {
  const dx = f.dx ?? 0, dy = f.dy ?? 0
  const out: Px[] = []
  if (look.level >= 2) out.push(...BOW.map(([x, y, c]): Px => [x + dx, y + dy, c]))
  const hat = look.level >= 3 ? HATS[look.month % HATS.length] : undefined
  // The hat rises with a jump but never out of the frame: it sinks into the head instead.
  if (hat) out.push(...spr(hat[1], hat[0] + dx, 1 + Math.max(dy, -1)))
  return out
}

const frameSvg = (p: Palette, f: Frame, look?: BuddyLook, i = 0): string => {
  const col = (ch: string) => ch === 'p' ? p.body : ch === 'h' ? p.hi : ch === 'c' ? p.cheek : ch === 's' ? p.body : (C[ch] ?? '#000')
  const dx = f.dx ?? 0, dy = f.dy ?? 0
  const body = bodyPx(p, f).map(([x, y, c]): Px => [x + dx, y + dy, c])
  const grid = new Map<string, string>()
  const sparks = look && look.level >= 4 ? SPARKS[i % SPARKS.length]! : []
  for (const [x, y, c] of [...sparks, ...body, ...(look ? accessories(look, f) : []), ...(f.props ?? [])]) {
    if (x >= -4 && x < 20 && y >= -4 && y < 20) grid.set(`${x},${y}`, col(c))
  }
  // merge horizontal runs, one <path> per colour
  const byColour = new Map<string, string[]>()
  const ys = [...new Set([...grid.keys()].map(k => +k.split(',')[1]!))].sort((a, b) => a - b)
  for (const y of ys) {
    const xs = [...grid.keys()].filter(k => +k.split(',')[1]! === y).map(k => +k.split(',')[0]!).sort((a, b) => a - b)
    let i = 0
    while (i < xs.length) {
      let j = i
      const c = grid.get(`${xs[i]},${y}`)!
      while (j + 1 < xs.length && xs[j + 1] === xs[j]! + 1 && grid.get(`${xs[j + 1]},${y}`) === c) j++
      const list = byColour.get(c) ?? []
      list.push(`M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`)
      byColour.set(c, list)
      i = j + 1
    }
  }
  return [...byColour].map(([c, d]) => `<path fill="${c}" d="${d.join('')}"/>`).join('')
}

/** The whole SVG document for one buddy in one state. Frames are toggled with CSS steps. */
export const buddySvg = (state: BuddyState, palette: number, px: number, look?: BuddyLook): string => {
  const p = look && look.level >= 4 ? GOLD : PALETTES[palette % PALETTES.length]!
  const { ms, frames } = ANIMS[state]
  const n = frames.length
  const period = (ms * n) / 1000
  let css = '.f{opacity:0;animation-duration:' + period + 's;animation-iteration-count:infinite;animation-timing-function:step-end}'
  const groups = frames.map((f, i) => {
    const a = (i / n) * 100, b = ((i + 1) / n) * 100
    css += `.f${i}{animation-name:k${i}}@keyframes k${i}{` +
      (i === 0 ? '0%{opacity:1}' : `0%{opacity:0}${a}%{opacity:1}`) +
      (i === n - 1 ? '' : `${b}%{opacity:0}`) + (i === n - 1 ? '100%{opacity:1}' : '100%{opacity:0}') + '}'
    return `<g class="f f${i}">${frameSvg(p, f, look, i)}</g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}" shape-rendering="crispEdges" style="background:transparent"><style>${css}</style>${groups}</svg>`
}
