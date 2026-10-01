/**
 * E-165 (2026-09-30): the one display format for a radio station on a log entry, shared by
 * the Radio Log grid, the Messages page, the ICS-213 "From" box and both the From and To
 * columns of the ICS-309 - so the same station can never read two different ways on screen
 * and on paper.
 *
 *   tactical + FCC call -> `CERT Team 1 (K7ABC)`
 *   tactical only       -> `CERT Team 1`
 *   FCC call only       -> `K7ABC`
 *   neither             -> `` (empty)
 *
 * Blank is a normal state, not a warning: not every position has a licensed operator (John,
 * 2026-09-30, decision 3). What to print for "nothing recorded" is the CALLER's wording -
 * ICS-309's From says `(not given)`, its To stays blank - so this returns an empty string and
 * leaves the placeholder to them.
 *
 * Pure, no Angular and no roster lookup: both values are the ones RECORDED on the entry at
 * save time (see RadioLogEntryType.tacticalCall), never re-resolved.
 */
export function formatStation(tactical?: string | null, callsign?: string | null): string {
  const t = (tactical ?? '').trim()
  const c = (callsign ?? '').trim()
  if (t && c) return `${t} (${c})`
  return t || c
}
