/**
 * E-301 level 1 (John 11-14): undo AND redo for the Entry form, N steps, in memory for the report being typed.
 * A plain stack of snapshots: `record()` after each committed change (leaving a field, a map click, a format
 * switch), `undo()` / `redo()` step through them, and `clear()` when the report is saved. Pure, no Angular.
 *
 * `same` decides whether a new snapshot is just the current one again (focus moving between fields without a
 * change), so those don't fill the history.
 */
export class UndoHistory<T> {
  private past: T[] = []
  private future: T[] = []
  private current: T | undefined

  constructor(private readonly max = 20, private readonly same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)) { }

  /** Starts over from `state` (a fresh or just-saved form). */
  reset(state: T): void {
    this.past = []
    this.future = []
    this.current = state
  }

  /** The form as it stands now. A change from the last snapshot becomes one undo step and drops any redo steps. */
  record(state: T): boolean {
    if (this.current !== undefined && this.same(this.current, state)) return false
    if (this.current !== undefined) {
      this.past.push(this.current)
      if (this.past.length > this.max) this.past.shift()
    }
    this.current = state
    this.future = []
    return true
  }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  /** The state to go back to, or undefined when there is none. */
  undo(): T | undefined {
    const prev = this.past.pop()
    if (prev === undefined) return undefined
    if (this.current !== undefined) this.future.push(this.current)
    this.current = prev
    return prev
  }

  redo(): T | undefined {
    const next = this.future.pop()
    if (next === undefined) return undefined
    if (this.current !== undefined) this.past.push(this.current)
    this.current = next
    return next
  }
}
