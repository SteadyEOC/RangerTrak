import { rehydrateDateFields } from './json-dates'
import { RadioLogStatusType } from './radio-log-entry.interface'
import { LocationCategoryType } from './mission-location.interface'
import { MissionType } from './mission.interface'
import { StatusKey } from './status-color'

/**
 * Versioned, forward-only migration for the persisted settings object.
 *
 * Settings are stored in localStorage and also travel inside a mission export, so an object
 * written by an older build can arrive at any time - on load, or through Restore mission
 * months later. Before Sprint E there was no mechanism for this at all: `settings.version`
 * was stamped from package.json on every load and never compared, so a stale object was
 * simply used as-is.
 *
 * Everything here is PURE - no injection, no logging, no storage - so it is unit-testable
 * without a browser and safe to call from both entry points (see mission.service.ts's load
 * path and backup.service.ts's importMission).
 */

/**
 * Bump when a migration step is added below, and add the matching `if (version < N)` block.
 * Mirrors MISSION_EXPORT_SCHEMA_VERSION in backup.service.ts rather than inventing a second
 * convention.
 *
 * 1 - status colors become semantic keys rather than raw CSS color strings.
 * 2 - backfill any field MissionType declares that the stored object lacks (BUG-3).
 * 3 - rename the legacy `google` settings block to `maplibre` (E-70).
 * 4 - drop `w3wLocale` and `defPlusCode`, both dead controls removed from MissionType
 *     during the E-84 audit's cleanup (E-89/E-90).
 */
export const MISSION_SCHEMA_VERSION = 4

/**
 * Default length of an operational period, in hours. Used in two places that must agree:
 * MissionService.initMission() seeds a new mission's end time with it, and MissionComponent
 * re-derives the end from it when a new start time would leave the end in the past.
 */
export const DEFAULT_OP_PERIOD_HOURS = 12

/**
 * The status colors as shipped before v1, paired with the semantic key each becomes.
 *
 * Matched on BOTH status name and color, deliberately. Matching on color alone would
 * rewrite a status the user had recolored to some other status's old default; matching on
 * name alone would discard a custom color the user chose on purpose. A stored color is
 * only replaced where it is still the untouched factory default for that status - anything
 * else is the user's decision and is left exactly as it is.
 */
const V0_STATUS_DEFAULTS: ReadonlyArray<{ status: string; color: string; key: StatusKey }> = [
  { status: 'Normal', color: 'lightyellow', key: 'normal' },
  { status: 'Location Report', color: 'aquamarine', key: 'location-report' },
  { status: 'Evidence Report', color: 'darkgoldenrod', key: 'evidence-report' },
  { status: 'Need Rest/Food', color: 'chartreuse', key: 'need-rest-food' },
  { status: 'Incident Check-in', color: 'silver', key: 'incident-check-in' },
  { status: 'Incident Check-out', color: 'dimgray', key: 'incident-check-out' },
  { status: 'Urgent', color: 'crimson', key: 'urgent' },
]

/** The v1 (current) factory defaults, for initMission() - accessible from a fresh install. */
export const DEFAULT_RADIO_LOG_STATUSES: ReadonlyArray<RadioLogStatusType> = [
  { status: 'Normal', color: 'normal', icon: 'check_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Location Report', color: 'location-report', icon: 'where_to_vote_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Evidence Report', color: 'evidence-report', icon: 'add_photo_alternate_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Need Rest/Food', color: 'need-rest-food', icon: 'mood_bad_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Incident Check-in', color: 'incident-check-in', icon: 'person_add_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Incident Check-out', color: 'incident-check-out', icon: 'person_remove_FILL0_wght400_GRAD0_opsz48.png' },
  { status: 'Urgent', color: 'urgent', icon: 'crisis_alert_FILL0_wght400_GRAD0_opsz48.png' },
]

/**
 * E-103 starter list, for initMission() - the maintainer's own suggested routine ICS
 * positions, editable per-mission via Settings > Field Report Recipients. Additive-only field
 * (see MissionType.recipientOptions213's own comment) - backfillMissingFields hands this to
 * any returning user whose stored settings predate the field, same as DEFAULT_RADIO_LOG_STATUSES.
 */
// Raised live, 2026-08-27: shortened from the previous 10-entry list (Incident Commander,
// Ops Section, Planning Section, Situation Awareness, Logistics Section, Finance/Admin
// Section, EOC, Sheriff/Police, Air unit, Utilities) to this shorter, plainer-worded set -
// existing missions' own saved lists are untouched either way, this only changes what
// "Restore suggested starter list" restores and what a brand-new mission starts with.
export const DEFAULT_RECIPIENT_OPTIONS_213: ReadonlyArray<string> = [
  'Incident Commander', 'Ops', 'Planning', 'Logistics', 'Finance', 'EOC', 'LEO', 'PI',
]

/**
 * ADR D-49 starter list, for initMission() - the Locations feature's default categories.
 * Colors are literal hex, not the semantic `--rt-status-*` keys radioLogStatuses uses:
 * those tokens are specifically for field-report status and adding a second consumer would
 * mean touching `_status.scss`/`_tokens.scss`/STATUS_KEYS for an unrelated feature. Editable
 * per-mission via `MissionType.locationTypes`, same as radioLogStatuses.
 *
 * `icon` values (E-117, 2026-09-25) are explicit here even though `ICON_BY_NAME` in
 * `location-marker.ts` would resolve every one of these names to the same shape anyway - a
 * BRAND NEW mission gets an icon it can immediately see and change in the grid, rather than
 * an invisible name-match a maintainer has to know exists. Renaming one of these categories
 * without picking a new icon still falls through to `ICON_BY_NAME`/pin, same as before this
 * field existed.
 */
export const DEFAULT_LOCATION_TYPES: ReadonlyArray<LocationCategoryType> = [
  { type: 'Command Post', color: '#1565C0', icon: 'command-post' },
  { type: 'Staging Area', color: '#EF6C00', icon: 'staging' },
  { type: 'Ranger First Aid', color: '#C62828', icon: 'first-aid' },
  // Expanded live 2026-08-30 from the original four (which included a catch-all "Other" -
  // dropped here per the maintainer's own specified list; locationMarkerSvg()'s generic-pin
  // fallback still covers any category name a mission adds beyond this starter set).
  { type: 'EOC', color: '#6A1B9A', icon: 'eoc' },
  { type: 'Fire Station', color: '#D84315', icon: 'fire-station' },
  { type: 'Dock', color: '#00838F', icon: 'dock' },
]

/**
 * Brings a persisted settings object up to MISSION_SCHEMA_VERSION.
 *
 * Pure: returns a new object and never mutates its argument. Unknown or missing
 * `schemaVersion` is treated as 0 (pre-Sprint-E) and migrated forward. A version NEWER than
 * this build understands is left alone rather than mangled - that is a user who has opened an
 * older build against newer data, and silently "downgrading" their settings would lose
 * information.
 */
export function migrateMission(raw: MissionType, defaults?: MissionType): MissionType {
  const incoming = (raw ?? {}) as MissionType & { schemaVersion?: unknown }
  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0

  let settings: MissionType = { ...incoming }

  if (version < MISSION_SCHEMA_VERSION) {
    if (version < 1) {
      settings = { ...settings, radioLogStatuses: toSemanticStatusColors(settings.radioLogStatuses) }
    }
    if (version < 3) {
      settings = renameGoogleToMaplibre(settings)
    }
    if (version < 4) {
      settings = dropDeadLocationFields(settings)
    }
    settings = { ...settings, schemaVersion: MISSION_SCHEMA_VERSION }
  }

  // Recurrence of BUG-3 (2026-08-20): Sprint H added six new MissionType fields
  // (showDD/showDDM/showDMS/showMGRS/showUTM/showMaidenhead) without bumping
  // MISSION_SCHEMA_VERSION, so this ran once for every user already at version 2 and never
  // again - `this.field() is not a function`, firing on every change-detection pass (once a
  // second, from the live clock in Header), for every returning user who had settings before
  // Sprint H shipped. Confirmed live on 0.16.7 from a real user's exported log: schemaVersion
  // was 2, and none of the six fields were present.
  //
  // Fixed at the root rather than by bumping to a version 3 that only defers the next
  // occurrence: backfillMissingFields is deliberately unconditional now, run on EVERY load
  // regardless of the version comparison above, not gated behind `version < N`. It was
  // already documented as safe to call repeatedly (pure, additive-only, never overwrites a
  // real value) - the version gate around it was the bug, not the function itself.
  return rehydrateDateFields(backfillMissingFields(settings, defaults), MISSION_DATE_FIELDS)
}

/** The MissionType fields declared `Date`. `lastPrintedAt` is optional; the rest always exist. */
const MISSION_DATE_FIELDS = ['settingsDate', 'opPeriodStart', 'opPeriodEnd', 'lastPrintedAt'] as const

/**
 * v1 -> v2. Adds any top-level key `MissionType` has that this stored object does not.
 *
 * Why this exists (BUG-3, 2026-08-19): settings saved before `googleGeocodingApiKey` was
 * introduced simply have no such property. `mission-maps-section` binds
 * `[formField]="form.googleGeocodingApiKey"`, and Signal Forms cannot build a field for a
 * property absent from the model - it threw `this.field(...) is not a function` on every
 * change-detection pass, making the whole Settings page unusable for returning users while a
 * fresh install was perfectly fine.
 *
 * Deliberately GENERAL rather than special-casing that one key: every setting added from now
 * on has exactly the same failure mode, and a targeted patch would only postpone the next
 * occurrence. Nested objects (`google`, `leaflet`) are filled one level deep for the same
 * reason.
 *
 * Only ever ADDS. An existing value - including a falsy one like `false` or `''` - is the
 * user's and is never overwritten.
 */
function backfillMissingFields(settings: MissionType, defaults?: MissionType): MissionType {
  if (!defaults) return settings

  const out = { ...settings } as Record<string, unknown>
  const src = defaults as unknown as Record<string, unknown>

  for (const key of Object.keys(src)) {
    if (!(key in out) || out[key] === undefined || out[key] === null) {
      out[key] = src[key]
      continue
    }
    // One level of nesting covers `google` and `leaflet`, whose sub-keys can go missing the
    // same way the top-level ones do.
    const defaultValue = src[key]
    const currentValue = out[key]
    if (isPlainObject(defaultValue) && isPlainObject(currentValue)) {
      out[key] = { ...defaultValue, ...currentValue }
    }
  }

  return out as unknown as MissionType
}

/**
 * v2 -> v3 (E-70): `google` was a legacy name for the MapLibre + PMTiles map's zoom/overview
 * settings, left over from the old Google Maps display this block predates (GmapComponent is
 * long gone). Renames the key in place, preserving every sub-value untouched. A stored object
 * with no `google` key at all - either written after this migration already shipped, or
 * pre-dating the block entirely - is left alone; backfillMissingFields (below) supplies a
 * fresh `maplibre` default the same way it would for any other missing field.
 */
function renameGoogleToMaplibre(settings: MissionType): MissionType {
  const raw = settings as unknown as Record<string, unknown>
  if (!('google' in raw)) return settings
  const { google, ...rest } = raw
  return { ...rest, maplibre: google } as unknown as MissionType
}

/**
 * v3 -> v4 (E-89/E-90): `w3wLocale` and `defPlusCode` were both settings for controls
 * verified dead during the E-84 documentation audit - `w3wLocale` was read by nothing at
 * all, and `defPlusCode`'s only consumer was `shared/mapping/plus-code.ts`, itself imported
 * by nothing (deleted the same day). Both are removed from `MissionType`; this drops them
 * from a returning user's stored object too, rather than leaving them as inert orphaned
 * keys forever. A stored object with neither key - either written after this migration
 * already shipped, or pre-dating both fields entirely - is left alone.
 */
function dropDeadLocationFields(settings: MissionType): MissionType {
  const raw = settings as unknown as Record<string, unknown>
  const { w3wLocale, defPlusCode, ...rest } = raw
  return rest as unknown as MissionType
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * v0 -> v1. Array ORDER is preserved exactly: `defRadioLogStatus` is an index into this
 * array, and sample-data.service.ts documents the same index-dependence, so reordering here
 * would silently repoint the default status and every generated sample report.
 */
function toSemanticStatusColors(
  statuses: readonly RadioLogStatusType[] | undefined
): RadioLogStatusType[] {
  if (!Array.isArray(statuses)) return [...DEFAULT_RADIO_LOG_STATUSES]

  return statuses.map(entry => {
    const match = V0_STATUS_DEFAULTS.find(
      d => d.status === entry?.status && String(entry?.color ?? '').trim().toLowerCase() === d.color
    )
    return match ? { ...entry, color: match.key } : { ...entry }
  })
}
