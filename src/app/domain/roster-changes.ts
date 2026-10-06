import type { RangerType } from '../shared/services/ranger.interface'

/**
 * "Export changes since import" (2026-10-05, John, from the regional-data session): which
 * rangers were added, edited or removed on this device since the roster was imported.
 *
 * The loop it closes: a coordinator builds the roster outside the app (the regional tools),
 * imports it at the comm desk, and during the event the desk adds walk-up volunteers and fixes
 * phone numbers and calls. Afterwards those changes have to get back to the master list. A full
 * roster export buries a handful of changes among hundreds of rows; this hands back just them,
 * keyed by `uid`, so the master's merge needs no guessing.
 *
 * Pure rules - no Angular, storage or DOM (src/app/domain/ is for exactly that). RangerService
 * stores the baseline and gathers the inputs.
 */

/**
 * What the roster looked like when it was imported: one fingerprint per ranger, keyed by uid.
 * Hashes only - no names or numbers are copied - so the record is small and adds no PII of its
 * own beside the roster it describes.
 */
export type RosterImportBaseline = {
  /** ms since 1970 of the most recent import. */
  importedAt: number
  /** What was imported, for the export's header: a file name, or "sample mission". */
  source: string
  /** uid -> rangerFingerprint() of that row as imported. */
  rows: Record<string, string>
}

/** The fields a coordinator would carry back to the master list. `uid` is the key, not a field. */
export const ROSTER_CHANGE_FIELDS = ['callsign', 'id', 'fullName', 'phone', 'image', 'team', 'role', 'note'] as const

export type RosterChanges = {
  importedAt: number
  source: string
  /** On this device, not in the import (walk-ups, or rows added by hand). */
  added: RangerType[]
  /** In the import, changed since. */
  edited: RangerType[]
  /** uids that were in the import and are gone from this device. */
  removed: string[]
  unchanged: number
}

/**
 * A short, stable hash of the fields in ROSTER_CHANGE_FIELDS. Whitespace at either end is
 * ignored, so re-saving a cell unchanged is not an edit. cyrb53 (public domain): not
 * cryptographic and doesn't need to be; it only has to notice a change.
 */
export function rangerFingerprint(r: RangerType): string {
  const text = JSON.stringify(ROSTER_CHANGE_FIELDS.map(f => String(r[f] ?? '').trim()))
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * The baseline after an import.
 *
 * - `replace` (plain "Import roster", a sample mission): the import IS the roster, so the
 *   baseline is every row now on the device.
 * - `merge` (a Setup file): only the rows the file wrote (`touchedUids`) are re-baselined.
 *   Rows the file didn't mention keep whatever standing they had, so a walk-up added before a
 *   second merge is still reported as added.
 */
export function baselineAfterImport(
  roster: readonly RangerType[],
  source: string,
  now: number,
  mode: 'replace' | 'merge',
  previous?: RosterImportBaseline | null,
  touchedUids?: readonly string[],
): RosterImportBaseline {
  const rows: Record<string, string> = mode === 'merge' ? { ...(previous?.rows ?? {}) } : {}
  const touched = mode === 'merge' ? new Set(touchedUids ?? []) : null
  for (const r of roster) {
    if (!r.uid) continue
    if (touched && !touched.has(r.uid)) continue
    rows[r.uid] = rangerFingerprint(r)
  }
  return { importedAt: now, source, rows }
}

/** Compares the roster now on the device with the baseline. */
export function rosterChanges(roster: readonly RangerType[], baseline: RosterImportBaseline): RosterChanges {
  const added: RangerType[] = [], edited: RangerType[] = []
  const present = new Set<string>()
  let unchanged = 0
  for (const r of roster) {
    const was = r.uid ? baseline.rows[r.uid] : undefined
    if (r.uid) present.add(r.uid)
    if (was === undefined) added.push(r)
    else if (was !== rangerFingerprint(r)) edited.push(r)
    else unchanged++
  }
  const removed = Object.keys(baseline.rows).filter(uid => !present.has(uid))
  return { importedAt: baseline.importedAt, source: baseline.source, added, edited, removed, unchanged }
}

/**
 * Parses a stored baseline. Anything malformed reads as "no import recorded", which the page
 * handles by offering the whole roster instead - never an error in front of an operator.
 */
export function parseRosterImportBaseline(raw: string | null): RosterImportBaseline | null {
  if (!raw) return null
  try {
    const b = JSON.parse(raw)
    if (!b || typeof b !== 'object' || typeof b.importedAt !== 'number' || !b.rows || typeof b.rows !== 'object') return null
    return { importedAt: b.importedAt, source: String(b.source ?? ''), rows: b.rows }
  } catch {
    return null
  }
}

/**
 * The export file. Same shape as a roster (`{rangers: [...]}`), so "Import roster" and the
 * regional tools read it as one; the extra keys say what it is. Each ranger carries `change`
 * ("added" or "edited"); the app's importer ignores unknown fields.
 */
export function rosterChangesFile(changes: RosterChanges, exportedAt: number) {
  return {
    kind: 'rangertrak-roster-changes',
    exportedAt: new Date(exportedAt).toISOString(),
    changesSince: new Date(changes.importedAt).toISOString(),
    importedFrom: changes.source,
    counts: { added: changes.added.length, edited: changes.edited.length, removed: changes.removed.length },
    rangers: [
      ...changes.added.map(r => ({ ...r, change: 'added' as const })),
      ...changes.edited.map(r => ({ ...r, change: 'edited' as const })),
    ],
    removedUids: changes.removed,
  }
}
