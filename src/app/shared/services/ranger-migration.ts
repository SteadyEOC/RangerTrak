import { RangerType } from './ranger.interface'

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

  return 'uid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
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
export type RangerMergeNote = { callsign: string; id: string }

export type RangerMergeResult = {
  /** The merged roster, existing rows first in their ORIGINAL order (an overwrite updates a
   *  row in place, it never moves it), incoming-only rows appended after. */
  rangers: RangerType[]
  added: RangerMergeNote[]
  overwritten: RangerMergeNote[]
  /** An incoming row whose `id` matched one existing ranger while its `callsign` matched a
   *  DIFFERENT existing ranger - id wins (see this function's own doc comment), but a
   *  collision like this is worth a line of its own, not just a console warning. */
  ambiguous: RangerMergeNote[]
}

/**
 * Merges an incoming roster (e.g. from a Setup file) into the roster already on this device,
 * additively - E-109 Setup files v2 (2026-08-31). Unlike `replaceAllRangers()`, nothing already
 * present is discarded unless an incoming row actually matches it.
 *
 * Match key: normalized `id` first, `callsign` (case-insensitive, trimmed) as the fallback -
 * `incoming` is run through `normalizeRangerIds()` first so ids/uids are canonical before any
 * matching happens. A row with neither a usable `id` nor `callsign` match is appended as new.
 *
 * **Ambiguous match**: if an incoming row's `id` matches existing ranger A while its `callsign`
 * matches a DIFFERENT existing ranger B, `id` wins (A is overwritten, B is untouched) - real id
 * credentials are the stronger signal, callsigns are the more casually reused of the two - but
 * the collision is reported in `ambiguous` so a human can look at it, not silently resolved.
 *
 * **On overwrite**: keeps the EXISTING row's `uid` (radio log entries already join on it - keeping
 * the incoming file's own freshly-minted uid would orphan them) and replaces every other field
 * with the incoming record's values. The existing array's order is preserved - an overwritten
 * row is updated in place, never moved to the end, so a coordinator's grid does not reshuffle
 * under them file after file.
 *
 * **On no match**: appended with incoming's own (already-minted) `uid`.
 *
 * Pure - no injection, no logging, no storage access - same convention every function in this
 * file follows. The caller hands the result to `RangerService.replaceAllRangers()`.
 */
export function mergeRangers(existing: readonly RangerType[], incoming: readonly RangerType[]): RangerMergeResult {
  const normalizedIncoming = normalizeRangerIds(incoming).rangers

  const rangers = existing.map(r => ({ ...r }))
  const byId = new Map<string, number>()
  const byCallsign = new Map<string, number>()
  rangers.forEach((r, i) => {
    if (r.id) byId.set(r.id, i)
    if (r.callsign.trim()) byCallsign.set(r.callsign.trim().toUpperCase(), i)
  })

  const added: RangerMergeNote[] = []
  const overwritten: RangerMergeNote[] = []
  const ambiguous: RangerMergeNote[] = []

  for (const inc of normalizedIncoming) {
    const note: RangerMergeNote = { callsign: inc.callsign, id: inc.id ?? '' }
    const idMatch = inc.id ? byId.get(inc.id) : undefined
    const callsignMatch = inc.callsign.trim() ? byCallsign.get(inc.callsign.trim().toUpperCase()) : undefined

    let matchIndex = idMatch
    if (idMatch !== undefined && callsignMatch !== undefined && idMatch !== callsignMatch) {
      ambiguous.push(note)
    } else if (matchIndex === undefined) {
      matchIndex = callsignMatch
    }

    if (matchIndex !== undefined) {
      const uid = rangers[matchIndex].uid
      rangers[matchIndex] = { ...inc, uid }
      overwritten.push(note)
      if (inc.id) byId.set(inc.id, matchIndex)
      if (inc.callsign.trim()) byCallsign.set(inc.callsign.trim().toUpperCase(), matchIndex)
    } else {
      rangers.push({ ...inc })
      added.push(note)
      if (inc.id) byId.set(inc.id, rangers.length - 1)
      if (inc.callsign.trim()) byCallsign.set(inc.callsign.trim().toUpperCase(), rangers.length - 1)
    }
  }

  return { rangers, added, overwritten, ambiguous }
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
