import { MissionLocationType } from './mission-location.interface'

/**
 * Versioned, forward-only migration for the persisted Locations list. Mirrors
 * ranger-migration.ts deliberately - same shape, same purity rules, same reasoning for why a
 * versioned wrapper exists from day one rather than being retrofitted once real data exists.
 *
 * Everything here is PURE - no injection, no logging, no storage access - so it is
 * unit-testable without a browser and safe to call from both entry points (MissionLocation-
 * Service's load path and BackupService's importMission).
 */

/**
 * Bump when a migration step is added below, and add the matching `if (version < N)` block.
 *
 * 1 - the versioned `{ schemaVersion, locations }` wrapper; every location gains an internal
 *     surrogate key `uid` (mirrors RangerType's `uid`, ADR D-42/D-43 pattern - see
 *     mission-location.interface.ts's own header comment).
 */
export const LOCATION_SCHEMA_VERSION = 1

/** The persisted shape of the Locations list. */
export type StoredLocations = {
  schemaVersion: number,
  locations: MissionLocationType[],
}

/**
 * Mints a fresh internal surrogate key. Duplicated from ranger-migration.ts's
 * `newRangerUid()` rather than imported - same small pure function, but "location" borrowing
 * a "ranger" name would misdescribe what it mints. See that function's own comment for the
 * full reasoning on why a UUID (degrading through weaker-but-still-adequate fallbacks) and
 * why minted at all versus a real-world credential (locations have no such credential to
 * preserve - there is nothing here for this app to avoid inventing).
 */
export function newLocationUid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined

  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID()
  }

  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40   // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80   // variant 10x
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return 'loc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * Guarantees every location a `uid`, minting one where it's missing or duplicated. Pure and
 * idempotent - a second run over its own output changes nothing.
 */
export function normalizeLocationUids(locations: readonly MissionLocationType[]): MissionLocationType[] {
  const usedUids = new Set<string>()
  return locations.map(location => {
    let uid = String(location?.uid ?? '').trim()
    if (!uid || usedUids.has(uid)) {
      uid = newLocationUid()
      while (usedUids.has(uid)) {
        uid = newLocationUid()
      }
    }
    usedUids.add(uid)
    return { ...location, uid }
  })
}

export type LocationMergeResult = {
  /** The merged list, existing rows first in their ORIGINAL order (an overwrite updates a row
   *  in place, it never moves it), incoming-only rows appended after. */
  locations: MissionLocationType[]
  added: string[]
  overwritten: string[]
}

/**
 * Merges an incoming Locations list (e.g. from a Setup file) into the list already on this
 * device, additively - E-109 Setup files v2 (2026-08-31), mirrors `mergeRangers()` deliberately.
 *
 * Match key: trimmed `name`, EXACT (not case-insensitive) match - "Command Post" and "command
 * post" are treated as two different locations rather than merged, since a location has no
 * stronger identifier the way a ranger's `id` is (no real-world credential to fall back on).
 * `incoming` is run through `normalizeLocationUids()` first.
 *
 * On overwrite, keeps the EXISTING row's `uid` and replaces every other field with the
 * incoming record's values, updated in place (order preserved, same reasoning as
 * `mergeRangers()`). On no match, appended with incoming's own (already-minted) `uid`.
 *
 * Pure - no injection, no logging, no storage access. The caller hands the result to
 * `MissionLocationService.replaceAllLocations()`.
 */
export function mergeLocations(existing: readonly MissionLocationType[], incoming: readonly MissionLocationType[]): LocationMergeResult {
  const normalizedIncoming = normalizeLocationUids(incoming)

  const locations = existing.map(l => ({ ...l }))
  const byName = new Map<string, number>()
  locations.forEach((l, i) => {
    const key = l.name.trim()
    if (key) byName.set(key, i)
  })

  const added: string[] = []
  const overwritten: string[] = []

  for (const inc of normalizedIncoming) {
    const key = inc.name.trim()
    const matchIndex = key ? byName.get(key) : undefined

    if (matchIndex !== undefined) {
      const uid = locations[matchIndex].uid
      locations[matchIndex] = { ...inc, uid }
      overwritten.push(key)
    } else {
      locations.push({ ...inc })
      added.push(key)
      if (key) byName.set(key, locations.length - 1)
    }
  }

  return { locations, added, overwritten }
}

/**
 * Brings a persisted Locations list up to LOCATION_SCHEMA_VERSION.
 *
 * Accepts what localStorage might actually hold: the versioned wrapper, a bare
 * `MissionLocationType[]` (in case a future import path hands one in directly), or something
 * unusable. Pure: returns a new object, never mutates its argument. A version NEWER than this
 * build understands is passed through untouched rather than mangled - same reasoning as
 * migrateRangers()/migrateMission(): that is an older build reading newer data.
 */
export function migrateLocations(raw: unknown): StoredLocations {
  if (Array.isArray(raw)) {
    return {
      schemaVersion: LOCATION_SCHEMA_VERSION,
      locations: normalizeLocationUids(raw as MissionLocationType[]),
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: LOCATION_SCHEMA_VERSION, locations: [] }
  }

  const incoming = raw as Partial<StoredLocations> & { schemaVersion?: unknown }
  const locations = Array.isArray(incoming.locations) ? incoming.locations : []
  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0

  if (version > LOCATION_SCHEMA_VERSION) {
    return { schemaVersion: version, locations }
  }

  if (version < LOCATION_SCHEMA_VERSION) {
    return {
      schemaVersion: LOCATION_SCHEMA_VERSION,
      locations: normalizeLocationUids(locations),
    }
  }

  return { schemaVersion: LOCATION_SCHEMA_VERSION, locations }
}
