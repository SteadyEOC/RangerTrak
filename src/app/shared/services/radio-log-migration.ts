import { rehydrateDateFields } from './json-dates'
import { RadioLogType } from './radio-log-entry.interface'

/**
 * Versioned, forward-only migration for the persisted radio log store.
 *
 * 2026-08-31: renamed from field-report-migration.ts / migrateRadioLog() /
 * FIELD_REPORT_SCHEMA_VERSION, a naming holdover from before the page itself was renamed
 * Reports -> Radio Log (0.75.0).
 *
 * Mirrors `mission-migration.ts` and `ranger-migration.ts` - same shape, same conventions,
 * same purity rules. Radio log entries had **no migration machinery at all** before this: the
 * load path was a bare `JSON.parse()`, so an object written by an older build was simply used
 * as-is and hoped for.
 *
 * Maintainer, 2026-08-26: *"there are no existing reports. no need for back fill at this
 * point. all should have some schema version of some sort for the future when we do need
 * this."* This file is exactly that - the **seam**, established while it is free, with no
 * transform behind it yet because there is no legacy data to transform. When a future change
 * does need one, it becomes a numbered `if (version < N)` block below and the version bumps.
 *
 * ## The `"version"` substring trap - read before touching RadioLogType
 *
 * `radio-log.service.ts`'s load path decides whether stored data is valid with
 * `localStorageFieldReports.indexOf("version") <= 0` - a naive SUBSTRING search over the raw
 * JSON text. Anything that removes the literal string `version` from the serialized object
 * makes every returning user's reports read as "corrupted" and silently reset to defaults.
 *
 * This is the same class of bug as [[settings-marker-field-trap]], which already bit this
 * project once. Adding `schemaVersion` is safe *because* it contains the substring `version`,
 * but that is luck, not design. Replacing that check with a real structural test is worth
 * doing when the load path is next touched.
 *
 * Everything here is PURE - no injection, no logging, no storage access.
 */

/**
 * Bump when a migration step is added below, and add the matching `if (version < N)` block.
 *
 * 0 - (implicit) the unversioned `RadioLogType` wrapper written before 2026-08-26. Note
 *     its own `version` field is the APP version string (e.g. "0.54.1"), stamped for
 *     information and never compared - it is not, and never was, a schema version.
 * 1 - the same wrapper carrying an explicit numeric `schemaVersion`.
 */
export const RADIO_LOG_SCHEMA_VERSION = 1

/**
 * Brings a persisted radio log store up to RADIO_LOG_SCHEMA_VERSION.
 *
 * Returns `null` when the input is not a usable store, rather than inventing one: building a
 * fresh empty store needs `MissionService` (for the app version and event name) and that
 * default-construction logic already lives in `RadioLogService.initEmptyRadioLog()`.
 * Duplicating it here would be a second source of truth for what "empty" means. A `null`
 * return means "call your own initializer".
 *
 * Pure: returns a new object and never mutates its argument. A version NEWER than this build
 * understands is passed through untouched rather than mangled - same reasoning as
 * `migrateMission()`.
 */
export function migrateRadioLog(raw: unknown): RadioLogType | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const incoming = raw as RadioLogType & { schemaVersion?: unknown }

  // Not a radio log store at all - the array is the one field nothing else here can stand
  // in for. Property NOT renamed - see RadioLogType.logEntries's own comment.
  if (!Array.isArray(incoming.logEntries)) {
    return null
  }

  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0

  // Newer than we understand - hand it back as-is rather than "migrating" it backwards.
  // Dates are still restored: that is deserialization, not migration, and a newer-schema
  // log still has to render on this build without throwing.
  if (version > RADIO_LOG_SCHEMA_VERSION) {
    return restoreDates({ ...incoming })
  }

  // v0 -> v1 is a pure stamp: there is no legacy report data in the field to transform, which
  // is precisely why this seam is cheap to add right now. Future steps go here.
  return restoreDates({ ...incoming, schemaVersion: RADIO_LOG_SCHEMA_VERSION })
}

/** `RadioLogType`'s own Date-typed field. */
const RADIO_LOG_DATE_FIELDS = ['date'] as const

/** `RadioLogEntryType`'s Date-typed fields; `revisedAt`/`printedAt` are optional. */
// 2026-10-01, John: exported so RadioLogService restores the same list (it had its own copies).
// `loggedAt` (E-07 replay groundwork) joined it 2026-10-02.
export const RADIO_LOG_ENTRY_DATE_FIELDS = ['date', 'revisedAt', 'printedAt', 'loggedAt'] as const

/**
 * Restores the store's own `date` and every entry's timestamps after a JSON round-trip -
 * see json-dates.ts for why this belongs at the boundary rather than in each consumer.
 *
 * Concretely (found 2026-08-31 on 0.90.5): without this, `buildIcs309Log()` sorts reports
 * with `a.date.getTime() - b.date.getTime()` and throws `getTime is not a function` for any
 * operator with two or more saved reports - i.e. printing the official communications log
 * failed for every real mission, while passing for an empty one.
 */
function restoreDates(store: RadioLogType): RadioLogType {
  const withStoreDate = rehydrateDateFields(store, RADIO_LOG_DATE_FIELDS)

  return {
    ...withStoreDate,
    logEntries: withStoreDate.logEntries.map(
      entry => rehydrateDateFields(entry, RADIO_LOG_ENTRY_DATE_FIELDS)),
  }
}
