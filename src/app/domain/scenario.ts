import type { RadioLogEntryType } from './model/radio-log-entry.interface'

/**
 * E-196 phase 1 (ADR D-66): training mode. Pure rules (D-57) - no Angular, DOM or storage.
 *
 * Scenario traffic is a DISPLAY mark only: an entry that was merged in (`sourceUid` set) and
 * whose operator is the exercise controller. Anyone can type that name into a file; nothing
 * trusts it. The constant is pinned to the exercise console's own EXERCISE_OPERATOR by
 * tools/exercise/operator-constant.test.js, so renaming one side alone goes red.
 */
export const EXERCISE_CONTROLLER = 'EXERCISE controller'

export function isScenarioEntry(entry: Pick<RadioLogEntryType, 'sourceUid' | 'operator'>): boolean {
  return !!entry.sourceUid && entry.operator === EXERCISE_CONTROLLER
}

/**
 * "At real time `realAt` the scenario stood at `scenarioAt`" (ISO instants). Both instants are
 * read as a pair: scenario time = real time + (scenarioAt - realAt). The scenario's own
 * wall clock has no time zone (the console holds it as UTC), so it is always FORMATTED in UTC,
 * and the manual entry converts the picked local date and time into the same UTC-labelled
 * form (`scenarioInstantFromLocal`). Stored times on entries stay real.
 */
export type ScenarioClock = { realAt: string, scenarioAt: string }

/** The scenario instant, in ms, at the real instant `realMs`. NaN when the clock is unreadable. */
export function scenarioTimeAt(clock: ScenarioClock, realMs: number): number {
  return realMs + (Date.parse(clock.scenarioAt) - Date.parse(clock.realAt))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number) => String(n).padStart(2, '0')

/** "Scenario 14 Jan 14:12" - the ONE wording of the scenario time (not "Day 3": the mission
 *  does not know the scenario's day 1). Every read-out and prompt calls this. */
export function formatScenarioTime(scenarioMs: number): string {
  const d = new Date(scenarioMs)
  if (Number.isNaN(d.getTime())) return ''
  return `Scenario ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** The formatted scenario time at the real instant, or '' for no clock / an unreadable one. */
export function scenarioLabelAt(clock: ScenarioClock | undefined, realMs: number): string {
  return clock ? formatScenarioTime(scenarioTimeAt(clock, realMs)) : ''
}

/** Hover text for the read-out: "Real 09:12 = scenario 14 Jan 14:12. Entry times stay real." */
export function scenarioOffsetExplanation(clock: ScenarioClock, realMs: number): string {
  const label = scenarioLabelAt(clock, realMs)
  if (!label) return ''
  const real = new Date(realMs)
  return `Real ${pad2(real.getHours())}:${pad2(real.getMinutes())} = ${label.replace(/^Scenario/, 'scenario')}. Entry times stay real.`
}

/** The scenario's wall clock (UTC-labelled) for a date and time picked in local terms. */
export function scenarioInstantFromLocal(picked: Date): string {
  return new Date(Date.UTC(picked.getFullYear(), picked.getMonth(), picked.getDate(),
    picked.getHours(), picked.getMinutes(), picked.getSeconds())).toISOString()
}

/** The inverse, for showing a stored scenario instant in the date and time picker. */
export function localFromScenarioInstant(iso: string): Date {
  const d = new Date(iso)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
}

/** A tolerant reader for a value from storage or a packet: an object whose two strings both
 *  parse as dates, else undefined (never throws, never invents). */
export function readScenarioClock(value: unknown): ScenarioClock | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { realAt, scenarioAt } = value as Record<string, unknown>
  if (typeof realAt !== 'string' || typeof scenarioAt !== 'string') return undefined
  if (Number.isNaN(Date.parse(realAt)) || Number.isNaN(Date.parse(scenarioAt))) return undefined
  return { realAt, scenarioAt }
}

/** True when the two clocks give the same scenario time for the same real moment (to the minute). */
export function sameScenarioClock(a: ScenarioClock | undefined, b: ScenarioClock | undefined): boolean {
  if (!a || !b) return !a && !b
  return Math.abs((Date.parse(a.scenarioAt) - Date.parse(a.realAt)) - (Date.parse(b.scenarioAt) - Date.parse(b.realAt))) < 60000
}
