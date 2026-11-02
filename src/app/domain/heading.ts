/**
 * E-268 (2026-11-02): the optional heading on a clue/evidence entry - which way the tracks,
 * drag marks or subject were going. Degrees TRUE north, whole numbers 0-359, always labelled
 * "T" so nobody reads a compass bearing into it. No magnetic toggle and no declination: the
 * scribe asks for degrees true, and notes it if the caller read a compass instead.
 *
 * Pure and Angular-free, same split as coordinate.ts.
 */

const POINTS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

/**
 * A stored or incoming heading made safe: a whole number 0-359, or null. 360 wraps to 0.
 * Anything else (text, NaN, a fraction, negative, above 360) becomes null rather than being
 * guessed at, so a bad heading never fails an import or a restore - the entry just arrives
 * without one.
 */
export function sanitizeHeading(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value > 360) return null
  return value === 360 ? 0 : value
}

/** The 16-point compass name for a heading in degrees (22.5 degrees per point, N centred on 0). */
export function compassPoint(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360
  return POINTS_16[Math.round(wrapped / 22.5) % 16]
}

/** "45° T (NE)", or '' when there is no usable heading. */
export function formatHeading(deg: number | null | undefined): string {
  const h = sanitizeHeading(deg)
  return h == null ? '' : `${h}° T (${compassPoint(h)})`
}

/**
 * `entry` with a bad `evidenceDirection` replaced by null; the same object back when it is fine
 * or absent. Applied where entries come in from outside (load, restore, merge).
 */
export function withSanitizedHeading<T extends { evidenceDirection?: unknown }>(entry: T): T {
  if (entry.evidenceDirection === undefined) return entry
  const clean = sanitizeHeading(entry.evidenceDirection)
  return clean === entry.evidenceDirection ? entry : { ...entry, evidenceDirection: clean }
}
