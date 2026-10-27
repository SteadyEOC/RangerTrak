import type { MissionLocationType } from '../shared/services/mission-location.interface'
import { normalizeLocationUids } from './mission-location-migration'

/**
 * Merging a list of Locations into the one on the device (Setup files, E-109; places files,
 * E-187 phase B). Split out of mission-location-migration.ts so the always-loaded service that
 * only needs to normalise and migrate does not carry merge code it never calls.
 */

export type LocationMergeResult = {
  /** The merged list, existing rows first in their ORIGINAL order (an overwrite updates a row
   *  in place, it never moves it), incoming-only rows appended after. */
  locations: MissionLocationType[]
  added: string[]
  /** Names of matched rows where at least one field actually changed. */
  overwritten: string[]
  /** For each `overwritten` row, in the same order: which fields changed. */
  changes: { name: string, changedFields: string[] }[]
  /** Names of matched rows where nothing differed (D-58: say so, rather than count it as an update). */
  unchanged: string[]
  /** The `uid` of every row this merge wrote or confirmed (added, updated or unchanged): what a
   *  layer record remembers (E-187 phase C, `domain/layers.ts`). */
  touchedUids: string[]
}

/** Two coordinates are the same place when they agree to 5 decimals (about a metre): the
 *  app's own export writes 5, so re-importing it must not call every row "updated". */
const sameCoordinate = (a: number, b: number) => a.toFixed(5) === b.toFixed(5)

/**
 * Merges an incoming Locations list (e.g. from a Setup file or a places file) into the list
 * already on this device, additively - E-109 Setup files v2 (2026-08-31), mirrors `mergeRangers()`
 * deliberately, including its D-58 rule: **a blank incoming field never erases** what the device
 * already holds (a blank category, address or note, or a coordinate that is not a number).
 *
 * Match key (E-187 phase C, ADR D-58 point 6): `uid` first, then trimmed `name`, EXACT (not
 * case-insensitive) - "Command Post" and "command post" are treated as two different locations
 * rather than merged, since a location has no stronger identifier the way a ranger's `id` is.
 * A uid match means a later layer that RENAMES a place updates it in place instead of adding a
 * copy; `name` is then one of the changed fields. `incoming` is run through
 * `normalizeLocationUids()` first (it mints a uid for a row with none, and that fresh uid
 * matches nothing, so such a row falls through to the name match as before).
 *
 * On a match, keeps the EXISTING row's `uid` and takes each non-blank incoming field, updated in
 * place (order preserved, same reasoning as `mergeRangers()`). A matched row where nothing
 * differs lands in `unchanged`; a changed one names its fields in `changes`. On no match,
 * appended with incoming's own (already-minted) `uid`; `opts.defaultType` fills a blank
 * category on such a new row only.
 *
 * Pure - no injection, no logging, no storage access. The caller hands the result to
 * `MissionLocationService.replaceAllLocations()`.
 */
export function mergeLocations(
  existing: readonly MissionLocationType[], incoming: readonly MissionLocationType[],
  opts: { defaultType?: string } = {},
): LocationMergeResult {
  const normalizedIncoming = normalizeLocationUids(incoming)

  const locations = existing.map(l => ({ ...l }))
  const byName = new Map<string, number>()
  const byUid = new Map<string, number>()
  locations.forEach((l, i) => {
    const key = l.name.trim()
    if (key) byName.set(key, i)
    if (l.uid) byUid.set(l.uid, i)
  })

  const added: string[] = []
  const overwritten: string[] = []
  const changes: { name: string, changedFields: string[] }[] = []
  const unchanged: string[] = []
  const touchedUids: string[] = []

  for (const inc of normalizedIncoming) {
    const key = inc.name.trim()
    const uidMatch = inc.uid ? byUid.get(inc.uid) : undefined
    const matchIndex = uidMatch !== undefined ? uidMatch : (key ? byName.get(key) : undefined)

    if (matchIndex !== undefined) {
      const current = locations[matchIndex]
      const next: MissionLocationType = { ...current }
      const changedFields: string[] = []

      // Only a uid match can differ in name (a name match is equal by construction).
      if (uidMatch !== undefined && key && key !== current.name.trim()) {
        changedFields.push('name')
        next.name = inc.name
        byName.set(key, matchIndex)
      }
      for (const field of ['type', 'address', 'note'] as const) {
        const value = inc[field]
        if (typeof value !== 'string' || value.trim() === '') continue   // blank keeps the existing value
        if (value.trim() !== String(current[field] ?? '').trim()) changedFields.push(field)
        next[field] = value
      }
      if (Number.isFinite(inc.lat) && !sameCoordinate(inc.lat, current.lat)) {
        changedFields.push('lat')
        next.lat = inc.lat
      }
      if (Number.isFinite(inc.lng) && !sameCoordinate(inc.lng, current.lng)) {
        changedFields.push('lng')
        next.lng = inc.lng
      }

      locations[matchIndex] = { ...next, uid: current.uid }
      if (current.uid) touchedUids.push(current.uid)
      if (changedFields.length) {
        overwritten.push(key)
        changes.push({ name: key, changedFields })
      } else {
        unchanged.push(key)
      }
    } else {
      const type = (inc.type ?? '').trim() === '' && opts.defaultType ? opts.defaultType : inc.type
      locations.push({ ...inc, type })
      added.push(key)
      if (key) byName.set(key, locations.length - 1)
      if (inc.uid) {
        byUid.set(inc.uid, locations.length - 1)
        touchedUids.push(inc.uid)
      }
    }
  }

  return { locations, added, overwritten, changes, unchanged, touchedUids }
}

/**
 * The named summary of a location merge, for the snackbar / session log: who was added, who was
 * updated (and which fields changed), how many were already identical. Never a bare count.
 * Shared by the Setup file card (Mission) and the Map page.
 */
export function describeLocationMerge(merge: LocationMergeResult, listLimit = 8): string {
  // A places file can hold hundreds of rows: name the first few, count the rest.
  const some = (items: string[], sep: string) => items.slice(0, listLimit).join(sep)
    + (items.length > listLimit ? `${sep}and ${items.length - listLimit} more` : '')
  const bits: string[] = []
  if (merge.added.length) bits.push(`added ${merge.added.length} (${some(merge.added, ', ')})`)
  if (merge.overwritten.length) {
    bits.push(`updated ${merge.overwritten.length} (${some(
      merge.changes.map(c => `${c.name}: ${c.changedFields.join(', ')}`), '; ')})`)
  }
  if (merge.unchanged.length) bits.push(`${merge.unchanged.length} already up to date`)
  return `places: ${bits.length ? bits.join('; ') : 'no changes'}`
}

