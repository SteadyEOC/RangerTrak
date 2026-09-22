/**
 * Overdue check-in escalation (E-118).
 *
 * One source of truth for "how late is this ranger, and how alarming should that look."
 * Previously this lived as an inline expression inside `mapLeaflet.component.ts`'s
 * `drawTrails()`, with its colours in that one component's SCSS, so the Rangers grid and the
 * Radio Log - the two places an operator actually scans for a quiet team - showed the same
 * elapsed time as plain text with no warning at all.
 *
 * ## Relative, not absolute
 *
 * The bands are measured against the mission's own expected check-in interval rather than
 * fixed wall-clock minutes. A team on a 15-minute cycle is alarmingly overdue at 45 minutes;
 * a team on a 2-hour cycle is not. The old hard-coded ramp (first colour at 20 minutes, red
 * at 80) silently assumed something like a 20-minute cycle and was wrong for every mission
 * that did not run on one.
 *
 * Band 0 means "not due yet" and is deliberately colourless: before the interval has even
 * elapsed there is nothing to report, and colouring it would make the normal state look like
 * a warning. Escalation runs from "due" (1x the interval) to "red" (RED_MULTIPLE x), in
 * BAND_COUNT even steps.
 *
 * With the default 30-minute interval this puts red at 90 minutes, which is the maintainer's
 * own stated default, and the intermediate steps land close to the old ramp's 10-minute
 * spacing - so the feel is preserved for a mission that keeps the default.
 */

/** Highest band index. Band 0 is "not due yet"; 1..BAND_COUNT escalate to red. */
export const OVERDUE_BAND_COUNT = 7

/**
 * Multiple of the check-in interval at which a ranger is shown as fully overdue (red).
 * A constant rather than a second mission field on purpose: the settings page asks for one
 * number an operator already knows (how often teams check in), not two that interact.
 */
export const OVERDUE_RED_MULTIPLE = 3

/** Check-in interval used when a mission has not set one. 30 min x3 = red at 90 min. */
export const DEFAULT_CHECK_IN_INTERVAL_MIN = 30

/** Whole minutes between `since` and now, never negative (clock skew, or a future-dated report). */
export function elapsedMinutes(since: Date | string | number, now: number = Date.now()): number {
  const then = since instanceof Date ? since.getTime() : new Date(since).getTime()
  if (!Number.isFinite(then)) return 0
  return Math.max(0, Math.round((now - then) / 60000))
}

/**
 * Escalation band for `elapsedMin`, given the mission's check-in interval.
 *
 * Returns 0 ("not due yet, show nothing") through OVERDUE_BAND_COUNT (red).
 *
 * `intervalMin <= 0` disables escalation entirely and always returns 0 - the deliberate
 * escape hatch for a mission with no fixed check-in cycle, which should see the elapsed
 * time as plain text rather than a colour ramp invented from a number nobody set.
 */
export function overdueBand(elapsedMin: number, intervalMin: number): number {
  if (!(intervalMin > 0) || !(elapsedMin > 0)) return 0
  const ratio = elapsedMin / intervalMin
  if (ratio < 1) return 0
  const step = (OVERDUE_RED_MULTIPLE - 1) / OVERDUE_BAND_COUNT
  return Math.min(OVERDUE_BAND_COUNT, Math.floor((ratio - 1) / step) + 1)
}
