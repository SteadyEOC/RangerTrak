import { newUid } from './uid'
import type { RangerType } from './model/ranger.interface'

/**
 * Versioned, forward-only migration for the persisted ranger roster, plus the ID assignment
 * ADR D-42 introduced.
 *
 * Mirrors `mission-migration.ts` deliberately - same shape, same conventions, same purity
 * rules - rather than inventing a second way to do this. Settings has had real migration
 * machinery since Sprint E; rangers and radio log entries had **none at all** (both were bare
 * `JSON.parse()` calls), which is the gap this closes.
 *
 * Maintainer, 2026-08-26: *"there are no existing reports. no need for back fill at this
 * point. all should have some schema version of some sort for the future when we do need
 * this."* So this deliberately does NOT carry defensive backfill logic for legacy data that
 * does not exist - it establishes the **seam** a future migration hooks into, while the
 * install base is still small enough that introducing a versioned storage shape is free.
 * Doing it now is the whole point; it gets materially harder once real rosters are in the
 * field. (An earlier draft of this file carried a `backfillReportRangerIds()` that resolved
 * each stored report's ranger from its callsign - removed on that direction, since the data
 * it rescued does not exist. If a future build DOES need it, it belongs as a numbered
 * migration step in `radio-log-migration.ts`, not as permanent defensive code.)
 *
 * Everything here is PURE - no injection, no logging, no storage access - so it is
 * unit-testable without a browser and safe to call from both entry points (RangerService's
 * load path and BackupService's importMission).
 */

/**
 * Bump when a migration step is added below, and add the matching `if (version < N)` block.
 *
 * 0 - (implicit) a BARE `RangerType[]` array, which is what localStorage holds today. Not a
 *     real version, just the absence of one.
 * 1 - the versioned `{ schemaVersion, rangers }` wrapper; every ranger gains an internal
 *     surrogate key `uid`, and any credential it carries is canonicalized into `id`
 *     (ADR D-42). Note "canonicalized", not "assigned", for `id` specifically: a ranger who
 *     has not checked in yet legitimately has no number, and this app does not mint them.
 *     `uid` IS minted - see `newRangerUid()` for why those two differ.
 *
 * The surrogate key was folded into version 1 rather than added as a version 2, deliberately:
 * this migration had not been wired into any service when it was added, so no localStorage
 * anywhere has ever held a version-1 roster. A version 2 would have been a migration step
 * from a state that never existed.
 */
export const RANGER_SCHEMA_VERSION = 1

/**
 * The persisted shape of the roster.
 *
 * Note this is the STORAGE format, deliberately distinct from the liberal IMPORT format
 * `RangerService.parseRosterJson()` accepts (a bare array, a `{rangers: []}` wrapper, or a
 * whole mission export). Import stays forgiving because it takes whatever file a team
 * actually has in hand; storage is strict and versioned because we own it.
 */
export type StoredRangers = {
  schemaVersion: number,
  rangers: RangerType[],
}

/** A well-formed ranger ID: a letter-led prefix, a hyphen, then digits. */
const ID_SHAPE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/

/** Prefix applied to a credential recorded as a bare number, with no prefix of its own. */
const CREDENTIAL_PREFIX = 'REW'

/** Zero-padding applied ONLY when promoting a bare number to `REW-####`. */
const BARE_NUMBER_PAD = 4

/**
 * Canonicalizes a candidate identifier, or returns '' when it cannot serve as one.
 *
 * - `'VI-0038'` -> `'VI-0038'`   (already ID-shaped: kept verbatim, see below)
 * - `'vi-0038'` -> `'VI-0038'`   (prefix upper-cased so case can't split one identity in two)
 * - `'VI-00 '`  -> `'VI-00'`     (trimmed)
 * - `'38'`      -> `'REW-0038'`  (bare number: gets the credential prefix, zero-padded)
 * - `'CmdPost'` -> `''`          (not an identifier - reported as missing, never invented)
 * - `''`/null   -> `''`
 *
 * **Why an existing credential is preserved verbatim.** D-42 states the format as
 * `REW-0038`/`TEW-1003`, but real stored `rew` values in this codebase are already ID-shaped
 * with a REGIONAL prefix - `VI-0038`, `VI-01` ("VI" for Vashon Island) - which presumably
 * matches the issuing agency's own records. Rewriting those to `REW-0038` would destroy that
 * correspondence with no way back. Digits inside an already-shaped value are likewise NOT
 * re-padded: `VI-1` stays `VI-1`, because the stored string is what matches a real record.
 *
 * If the maintainer decides they DO want every credential force-normalized to `REW-`, that is
 * a one-line change here - but it should be a deliberate, stated decision, not a side effect.
 */
export function normalizeRangerId(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) {
    return ''
  }

  const shaped = ID_SHAPE.exec(value)
  if (shaped) {
    return `${shaped[1].toUpperCase()}-${shaped[2]}`
  }

  if (/^\d+$/.test(value)) {
    return `${CREDENTIAL_PREFIX}-${value.padStart(BARE_NUMBER_PAD, '0')}`
  }

  return ''
}

/**
 * Mints a fresh internal surrogate key.
 *
 * **This app mints `uid` but never mints `id`** - the asymmetry is the entire justification
 * for having a surrogate. A `uid` has no real-world meaning and answers to no outside
 * authority, so generating one invents nothing. A `TEW-####` credential is issued by the
 * incident at check-in, so generating one would fabricate a credential that could collide
 * with a genuinely issued number.
 *
 * A UUID rather than a counter: the roadmap already flags that "two devices independently
 * incrementing their own counter will collide the moment their logs merge", and a mission
 * export moving between devices is exactly that. A UUID needs no coordination.
 *
 * `crypto.randomUUID()` needs a secure context, which `rangertrak.org` (HTTPS) and localhost
 * both are - but this app is built to run in odd places, so it degrades rather than throwing:
 * `getRandomValues` first, `Math.random` only as a last resort. The fallbacks are weaker
 * sources of randomness, not weaker uniqueness for this purpose - a roster is tens of rows,
 * not billions, and `normalizeRangerIds()` re-mints on collision regardless.
 */
export function newRangerUid(): string {
  return newUid()
}

/** True when a string is already a canonical ranger ID. */
export function isRangerId(value: unknown): boolean {
  const normalized = normalizeRangerId(value)
  return normalized !== '' && normalized === String(value ?? '').trim().replace(
    ID_SHAPE, (_m, p: string, d: string) => `${p.toUpperCase()}-${d}`)
}

/** What `normalizeRangerIds()` found, so a caller can log it or surface it as a warning. */
export type RangerIdAudit = {
  /**
   * The roster with every recognizable `id` canonicalized and every ranger guaranteed a
   * `uid`. No CREDENTIAL is ever invented; the surrogate key always is (see
   * `newRangerUid()` for why those two are different).
   */
  rangers: RangerType[],
  /** Had no `uid`, or one that duplicated another ranger's, so a fresh one was minted. */
  uidsMinted: number,
  /** Carried a usable id already (in `id`, or seeded from `rew`). */
  identified: number,
  /**
   * Have NO usable identifier. These are not an error - a ranger on a pre-loaded roster who
   * has not checked in yet genuinely does not have a number, because the incident issues it.
   * Surface it so someone can fill it in at check-in; do NOT invent one.
   */
  missing: number,
  /**
   * Ids held by more than one ranger, in first-seen order. Genuinely ambiguous - every report
   * filed against one of these cannot be attributed to a single person - so this is worth a
   * loud warning, but it is the operator's data to fix, not ours to silently rewrite.
   */
  duplicates: string[],
}

/**
 * Canonicalizes whatever identifiers a roster already carries, and reports what is missing or
 * duplicated. **It never invents an identifier.**
 *
 * Maintainer, 2026-08-26: *"tew numbers are assigned at checkin, not by the app."* That is a
 * real-world organizational process - a Temporary Emergency Worker number is issued when
 * someone signs in at the incident - so an app-minted `TEW-1000` would be a fabricated
 * credential that could collide with a genuinely issued one. An earlier draft of this
 * function did exactly that; it was wrong and is gone.
 *
 * A blank id is therefore a legitimate, expected state ("hasn't checked in yet"), reported
 * via `missing` rather than papered over - consistent with how this app already treats a
 * blank callsign (the map's `UNASSIGNED_MARKER`, the Rangers grid's own "⚠ (none set)"):
 * flag the gap, don't hide it behind invented data.
 *
 * Exported separately from `migrateRangers()` because it is used in two places: as the
 * v0 -> v1 migration step, and as normalization on **import**, where a roster file may carry
 * a `rew` credential but no `id` at all.
 *
 * Source of an id, in priority order: an existing valid `id`, then `rew`. Nothing else.
 *
 * D-42 phase 8: `RangerType` no longer declares `rew` - `parseRosterJson()` and `AddRanger()`
 * fold it into `id` themselves before a ranger ever reaches this function. The `(ranger as
 * any)?.rew` read below stays anyway, ONLY for the v0 (bare-array, pre-`id`-field) migration
 * step: that path hands this function raw, untyped `JSON.parse()` output straight from
 * localStorage, which - for anyone updating from a build old enough to predate `id` entirely -
 * may still be a literal `{rew: "VI-0038", ...}` object with no `id` at all. Dropping this
 * would silently blank out that person's only recorded credential on their very first load of
 * a phase-8-or-later build.
 *
 * Pure and idempotent: returns new ranger objects, never mutates its input, and a second run
 * over its own output changes nothing.
 */
export function normalizeRangerIds(rangers: readonly RangerType[]): RangerIdAudit {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  const usedUids = new Set<string>()

  let identified = 0
  let missing = 0
  let uidsMinted = 0

  const normalized = rangers.map(ranger => {
    // ---- the surrogate key: always present, minted by us when it isn't ----------------
    // A duplicate uid is re-minted rather than reported, which is the exact OPPOSITE of how
    // a duplicate `id` is handled below - and correctly so. A uid is ours, carries no
    // real-world meaning, and two rangers sharing one is always corruption (a hand-edited
    // file, a copy-pasted row), never a fact about the world worth preserving. A duplicate
    // credential, by contrast, is a real claim about two people that only the operator can
    // adjudicate.
    let uid = String(ranger?.uid ?? '').trim()
    if (!uid || usedUids.has(uid)) {
      uid = newRangerUid()
      while (usedUids.has(uid)) {
        uid = newRangerUid()
      }
      uidsMinted++
    }
    usedUids.add(uid)

    // ---- the credential: canonicalized if present, NEVER invented --------------------
    // An explicit `id` wins; `rew` seeds one where no `id` exists yet (ADR D-42 folds the
    // WA-specific "REW" column into the generic identifier). See this function's own header
    // comment (D-42 phase 8) for why `.rew` is still read here despite not being on the type.
    const id = normalizeRangerId(ranger?.id) || normalizeRangerId((ranger as any)?.rew)

    if (!id) {
      missing++
      return { ...ranger, uid, id: '' }
    }

    identified++
    if (seen.has(id)) {
      duplicated.add(id)
    } else {
      seen.add(id)
    }
    return { ...ranger, uid, id }
  })

  return {
    rangers: normalized,
    uidsMinted,
    identified,
    missing,
    duplicates: [...duplicated],
  }
}

/**
 * Brings a persisted roster up to RANGER_SCHEMA_VERSION.
 *
 * Accepts what localStorage might actually hold: the versioned wrapper, a bare `RangerType[]`
 * (the pre-versioning shape, treated as version 0), or something unusable.
 *
 * Pure: returns a new object and never mutates its argument. A version NEWER than this build
 * understands is passed through untouched rather than mangled - same reasoning as
 * `migrateMission()`: that is someone running an older build against newer data, and
 * silently "downgrading" it would lose information.
 *
 * Anything unparseable yields an empty, current-version roster. An empty roster is a
 * meaningful state in its own right since 0.55.0 ("Rangers should start blank. That should
 * indicate a new mission!"), so that is a correct answer rather than a papered-over failure.
 */
/** One row named in a merge summary - never a bare count (capability, not policy: show the
 *  human what happened, let them judge it). */
export type RangerMergeNote = {
  callsign: string
  id: string
  /** On an `overwritten` note: which fields the import actually changed (E-187 preview). */
  changedFields?: string[]
  /** The uid of the row this import wrote (the existing uid on an overwrite). Lets the caller
   *  re-baseline exactly those rows for "Export changes since import" (domain/roster-changes.ts). */
  uid?: string
}

export type RangerMergeResult = {
  /** The merged roster, existing rows first in their ORIGINAL order (an overwrite updates a
   *  row in place, it never moves it), incoming-only rows appended after. */
  rangers: RangerType[]
  added: RangerMergeNote[]
  /** Matched rows the import CHANGED; each note names the fields in `changedFields`. */
  overwritten: RangerMergeNote[]
  /** Matched rows where nothing differed, so nothing was written (D-58: shown as "Unchanged"). */
  unchanged: RangerMergeNote[]
  /** An incoming row whose `id` matched one existing ranger while its `callsign` matched a
   *  DIFFERENT existing ranger - id wins (see this function's own doc comment), but a
   *  collision like this is worth a line of its own, not just a console warning. */
  ambiguous: RangerMergeNote[]
  /**
   * Incoming uid -> the uid that row ended up with on this device, for every incoming row that
   * arrived with one (D-59). A matched person keeps the EXISTING uid, so the sender's radio log
   * entries, still pointing at the sender's uid, must be re-pointed with this map before they
   * are merged. An unmatched (added) person keeps their own uid, so it maps to itself.
   */
  uidRemap: Record<string, string>
}

/**
 * Merges an incoming roster (e.g. from a Setup file) into the roster already on this device,
 * additively - E-109 Setup files v2 (2026-08-31). Unlike `replaceAllRangers()`, nothing already
 * present is discarded unless an incoming row actually matches it.
 *
 * Match key: an exact `uid` first, then normalized `id` (callsign picks between several rangers
 * who share one), then `callsign` (case-insensitive, trimmed) as the fallback - `incoming` is run
 * through `normalizeRangerIds()` first so ids/uids are canonical before any matching happens. A
 * row with no match is appended as new. Each existing row is matched at most once per import, so
 * two incoming people who share an `id` both survive (2026-10-05).
 *
 * **Ambiguous match**: if an incoming row's `id` matches existing ranger A while its `callsign`
 * matches a DIFFERENT existing ranger B, `id` wins (A is overwritten, B is untouched) - real id
 * credentials are the stronger signal, callsigns are the more casually reused of the two - but
 * the collision is reported in `ambiguous` so a human can look at it, not silently resolved.
 *
 * **On overwrite**: keeps the EXISTING row's `uid` (radio log entries already join on it - keeping
 * the incoming file's own freshly-minted uid would orphan them) and replaces a field with the
 * incoming value ONLY when that value is non-empty (D-58: a blank cell never erases what the
 * device already holds - a second list with no phone number for someone must not wipe the first
 * list's). A matched row where nothing differs lands in `unchanged`, not `overwritten`; a changed
 * one names its `changedFields`. The existing array's order is preserved - an overwritten
 * row is updated in place, never moved to the end, so a coordinator's grid does not reshuffle
 * under them file after file.
 *
 * **On no match**: appended with incoming's own (already-minted) `uid`.
 *
 * Pure - no injection, no logging, no storage access - same convention every function in this
 * file follows. The caller hands the result to `RangerService.replaceAllRangers()`.
 */
/** The text fields a merge carries over from an incoming row (never `uid`, which stays the existing one). */
const MERGE_FIELDS = ['id', 'callsign', 'fullName', 'phone', 'image', 'team', 'role', 'note'] as const

export function mergeRangers(existing: readonly RangerType[], incoming: readonly RangerType[]): RangerMergeResult {
  const normalizedIncoming = normalizeRangerIds(incoming).rangers

  const rangers = existing.map(r => ({ ...r }))
  const byUid = new Map<string, number>()
  const byId = new Map<string, number[]>()
  const byCallsign = new Map<string, number[]>()
  const push = (map: Map<string, number[]>, key: string, i: number) => map.set(key, [...(map.get(key) ?? []), i])
  rangers.forEach((r, i) => {
    if (r.uid) byUid.set(r.uid, i)
    if (r.id) push(byId, r.id, i)
    if (r.callsign.trim()) push(byCallsign, r.callsign.trim().toUpperCase(), i)
  })

  // Rows this import has already written. A later incoming row never lands on one: two people
  // who share an `id` on purpose (Vashon's VI-0007 is on a husband and wife) used to collapse
  // into one, the second overwriting the first, even on an empty device.
  const claimed = new Set<number>()
  const unclaimed = (list: number[] | undefined) => (list ?? []).filter(i => !claimed.has(i))

  const added: RangerMergeNote[] = []
  const overwritten: RangerMergeNote[] = []
  const unchanged: RangerMergeNote[] = []
  const ambiguous: RangerMergeNote[] = []

  const uidRemap: Record<string, string> = {}

  for (const [incIndex, inc] of normalizedIncoming.entries()) {
    // The uid the row arrived with. normalizeRangerIds() keeps order, and re-mints only a blank
    // or duplicated uid, so a row whose uid survived unchanged is the one entries point at.
    const originalUid = String(incoming[incIndex]?.uid ?? '').trim()
    const remapKey = originalUid && originalUid === inc.uid ? originalUid : ''
    const note: RangerMergeNote = { callsign: inc.callsign, id: inc.id ?? '' }
    const uidMatch = inc.uid ? byUid.get(inc.uid) : undefined
    const idMatches = inc.id ? unclaimed(byId.get(inc.id)) : []
    const callsignMatches = inc.callsign.trim() ? unclaimed(byCallsign.get(inc.callsign.trim().toUpperCase())) : []

    // uid first: a roster file that carries the roster-tooling crosswalk's uids names the
    // person exactly. Then id, with callsign choosing between several people who share it.
    // Then callsign alone.
    let matchIndex: number | undefined
    if (uidMatch !== undefined && !claimed.has(uidMatch)) {
      matchIndex = uidMatch
    } else if (idMatches.length) {
      matchIndex = idMatches.find(i => callsignMatches.includes(i)) ?? idMatches[0]
      if (callsignMatches.length && !callsignMatches.includes(matchIndex)) ambiguous.push(note)
    } else {
      matchIndex = callsignMatches[0]
    }

    if (matchIndex !== undefined) {
      const current = rangers[matchIndex]
      const uid = current.uid
      const next: RangerType = { ...current }
      const changedFields: string[] = []
      for (const field of MERGE_FIELDS) {
        const value = inc[field]
        if (typeof value !== 'string' || value.trim() === '') continue   // blank keeps the existing value
        if (value.trim() !== String(current[field] ?? '').trim()) changedFields.push(field)
        next[field] = value
      }
      rangers[matchIndex] = { ...next, uid }
      claimed.add(matchIndex)
      if (remapKey && uid) uidRemap[remapKey] = uid
      if (changedFields.length) overwritten.push({ ...note, uid, changedFields })
      else unchanged.push({ ...note, id: current.id ?? '', callsign: current.callsign, uid })
    } else {
      rangers.push({ ...inc })
      claimed.add(rangers.length - 1)
      added.push({ ...note, uid: inc.uid })
      if (remapKey && inc.uid) uidRemap[remapKey] = inc.uid
    }
  }

  return { rangers, added, overwritten, unchanged, ambiguous, uidRemap }
}

/**
 * The named summary of a merge, for the snackbar / session log: who was added, who was updated
 * (and which fields changed), how many were already identical, and any ambiguous id/call-sign
 * match. Never a bare count (capability, not policy: show the human what happened). Shared by
 * the Rangers page and the Setup file card (Mission).
 */
export function describeRangerMerge(merge: RangerMergeResult): string {
  const label = (r: { callsign: string; id: string }) => r.callsign || r.id || '(unidentified)'
  const bits: string[] = []
  if (merge.added.length) bits.push(`added ${merge.added.length} (${merge.added.map(label).join(', ')})`)
  if (merge.overwritten.length) {
    bits.push(`updated ${merge.overwritten.length} (${merge.overwritten
      .map(r => r.changedFields?.length ? `${label(r)}: ${r.changedFields.join(', ')}` : label(r)).join('; ')})`)
  }
  if (merge.unchanged.length) bits.push(`${merge.unchanged.length} already up to date`)
  if (merge.ambiguous.length) bits.push(`AMBIGUOUS id/callsign match, id won (${merge.ambiguous.map(label).join(', ')})`)
  return `rangers: ${bits.length ? bits.join('; ') : 'no changes'}`
}

/**
 * Who a Replace would remove: everyone already on the device whom the merge did not match
 * (a matched row is updated or unchanged, so it survives; an unmatched one is dropped).
 */
export function rangersRemovedByReplace(existing: readonly RangerType[], merge: RangerMergeResult): RangerType[] {
  const kept = new Set([...merge.overwritten, ...merge.unchanged].map(n => n.uid).filter((u): u is string => !!u))
  return existing.filter(r => !r.uid || !kept.has(r.uid))
}

/** The Replace warning: counts from the merge, and the people who would be removed by name. */
export function describeReplace(existing: readonly RangerType[], merge: RangerMergeResult, maxNamed = 10): string {
  const removed = rangersRemovedByReplace(existing, merge)
  const label = (r: RangerType) => {
    const name = (r.fullName || '').trim()
    const call = (r.callsign || '').trim()
    return name && call ? `${name} (${call})` : name || call || r.id || '(unidentified)'
  }
  const counts = `${merge.added.length} added, ${merge.overwritten.length} updated, ${merge.unchanged.length} unchanged.`
  if (!removed.length) return `${counts}\nNobody on the current roster would be removed.`
  const named = removed.slice(0, maxNamed).map(r => `  - ${label(r)}`).join('\n')
  const more = removed.length > maxNamed ? `\n  ...and ${removed.length - maxNamed} more` : ''
  const who = removed.length === 1 ? 'person' : 'people'
  return `${counts}\n${removed.length} ${who} on the current roster would be REMOVED because they are not in the file:\n${named}${more}`
}

export function migrateRangers(raw: unknown): StoredRangers {
  // Version 0: a bare array, which is exactly what localStorage holds today.
  if (Array.isArray(raw)) {
    return {
      schemaVersion: RANGER_SCHEMA_VERSION,
      rangers: normalizeRangerIds(raw as RangerType[]).rangers,
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: RANGER_SCHEMA_VERSION, rangers: [] }
  }

  const incoming = raw as Partial<StoredRangers> & { schemaVersion?: unknown }
  const rangers = Array.isArray(incoming.rangers) ? incoming.rangers : []
  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0

  // Newer than we understand - hand it back as-is rather than "migrating" it backwards.
  if (version > RANGER_SCHEMA_VERSION) {
    return { schemaVersion: version, rangers }
  }

  if (version < RANGER_SCHEMA_VERSION) {
    // v0 -> v1: every ranger gains a unique id (ADR D-42).
    return {
      schemaVersion: RANGER_SCHEMA_VERSION,
      rangers: normalizeRangerIds(rangers).rangers,
    }
  }

  return { schemaVersion: RANGER_SCHEMA_VERSION, rangers }
}
