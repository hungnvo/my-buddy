export type BuddyState =
  | 'idle' | 'thinking' | 'reading' | 'searching' | 'editing' | 'running'
  | 'browsing' | 'spawning' | 'waiting' | 'error' | 'done' | 'compacting' | 'working' | 'background'

/** A background shell or monitor that outlives the tool call that started it */
export type BuddyTask = {
  id: string
  kind: 'shell' | 'monitor'
  /** program name for a shell (never its arguments), a short description for a monitor */
  label: string
  /** `$.clock.now()` milliseconds */
  startedAt: number
  /** `$.clock.now()` milliseconds after which its end is presumed lost; absent in a value stored before `tasks-2` (8 hours) */
  deadline?: number
  /** the subagent that started it; absent for the main thread and in a value stored before this field */
  agentId?: string
}

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
    'my-buddy': { view: Shaped<BuddyView>; usage: Shaped<BuddyUsage | null>; tasks: Shaped<BuddyTask[]> }
  }
}
