export type BuddyState =
  | 'idle' | 'thinking' | 'reading' | 'searching' | 'editing' | 'running'
  | 'browsing' | 'spawning' | 'waiting' | 'error' | 'done' | 'compacting' | 'working'

export type BuddyView = {
  main: BuddyState
  /** short note on what the main buddy is working on, e.g. a file name; set with `main`, cleared by a change without one */
  detail?: string
  subs: { id: string; state: BuddyState; seen: number }[]
  /** true only while /buddy-demo runs; while true the demo drives the states */
  demo: boolean
}

/** What the main buddy wears: level 2 a bow tie, 3 a hat of the month, 4 a golden body with sparkles */
export type BuddyLook = {
  level: number
  /** 0 (January) to 11 */
  month: number
}

export type BuddyLimit = {
  kind: 'five_hour' | 'seven_day'
  percentUsed: number
  /** ISO 8601 */
  resetsAt?: string
}

export type BuddyUsage = {
  tokens?: number
  window: number
  percent?: number
  limits: BuddyLimit[]
}

export type BuddyCache = {
  /** when the main thread's last API response arrived, `$.clock.now()` milliseconds */
  at: number
  /** how long that response keeps the prompt cache warm */
  ttlMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'my-buddy': { view: Shaped<BuddyView>; usage: Shaped<BuddyUsage | null> }
  }
}
