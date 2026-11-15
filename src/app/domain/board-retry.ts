/**
 * E-216 slice 1: when the RangerView web server can't be reached, try again by itself - after 5 s, 10 s, 20 s,
 * 40 s, then every 60 s - and start over from 5 s after a success. The caller decides what
 * "try again" does (and so never takes over a RangerView web server another device holds, D-61 section 6).
 */
export const RETRY_STEPS_MS = [5000, 10000, 20000, 40000]
export const RETRY_MAX_MS = 60000

export function retryDelayMs(failures: number): number {
  return failures < RETRY_STEPS_MS.length ? RETRY_STEPS_MS[failures] : RETRY_MAX_MS
}

export class BoardRetry {
  private failures = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(private run: () => void) {}

  /** An attempt failed: arrange the next one, unless one is already arranged. */
  failed(): void {
    if (this.timer !== undefined) return
    const delay = retryDelayMs(this.failures++)
    this.timer = setTimeout(() => { this.timer = undefined; this.run() }, delay)
  }

  /** An attempt worked: forget the failures. */
  succeeded(): void {
    this.stop()
    this.failures = 0
  }

  /** Run now (the window woke up). Leaves the back-off where it was. */
  now(): void {
    this.cancelTimer()
    this.run()
  }

  /** Publishing is off or taken over: no timers left. */
  stop(): void {
    this.cancelTimer()
    this.failures = 0
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
