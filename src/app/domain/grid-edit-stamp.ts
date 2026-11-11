/**
 * E-282 (2026-11-11, ADR D-47 note): a Radio Log grid cell edit stamps `revisedAt`, so the correction
 * travels through a hand-over Merge (the later `revisedAt` wins, domain/entry-merge.ts).
 *
 * Only a REAL change stamps: the old and new values are compared as strings, so `3` vs `'3'`
 * (and null vs '') is not an edit. Returns true when it stamped. Pure apart from mutating `entry`,
 * which is the grid's own row object (the grid has already written the new value into it).
 */
export function stampRevisedIfChanged(
  entry: { revisedAt?: Date } | null | undefined,
  oldValue: unknown,
  newValue: unknown,
  now: Date = new Date(),
): boolean {
  if (!entry) return false
  const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  if (norm(oldValue) === norm(newValue)) return false
  entry.revisedAt = now
  return true
}
