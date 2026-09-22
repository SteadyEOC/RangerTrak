import { RadioLogStatusType } from './radio-log-entry.interface'
import { LocationCategoryType } from './mission-location.interface'

/**
 * This has 'all' event data (aside from Rangers & Field Reports)
 * for readily serialization/dehydration
 */
export type MissionType = {
  // Persisted-shape version, owned by mission-migration.ts (MISSION_SCHEMA_VERSION).
  // Distinct from `version` below, which is the *app* version stamped from package.json on
  // every load and plays no part in migration decisions.
  schemaVersion: number,

  settingsName: string, // FUTURE: Use if people want to load and saveas, or have various 'templates'
  settingsDate: Date, // when last edited...

  mission: string,
  event: string,
  eventNotes: string,
  opPeriod: string,
  opPeriodStart: Date,
  opPeriodEnd: Date,

  application: string,
  version: string,
  debugMode: boolean,

  defLat: number,
  defLng: number,
  allowManualPinDrops: boolean,

  // Per-mission coordinate system visibility (Sprint H). Each independently gates a
  // block in location.component.html; Entry's own "Show all systems" checkbox
  // overrides all six for the current session without changing this setting. All
  // default true - hiding a system is something a mission opts into.
  showDD: boolean,
  showDDM: boolean,
  showDMS: boolean,
  showMGRS: boolean,
  showUTM: boolean,
  showMaidenhead: boolean,

  // User-supplied Google Geocoding API key (optional). Activates GoogleGeocoder as the
  // GeocodingProvider instead of the default, no-key Nominatim. Lives only in this
  // user's localStorage - never in secrets.json, never bundled. Empty string = disabled.
  googleGeocodingApiKey: string,

  // Zoom/overview settings for the MapLibre + PMTiles map. E-70: was `google`, a legacy
  // name left over from the old Google Maps display this field predates - renamed once
  // that engine (and GmapComponent) was fully gone, via a schemaVersion 2->3 migration.
  maplibre: {
    defZoom: number,  // or just zoom to bounds?
    markerScheme: string,
    overviewDifference: number,
    overviewMinZoom: number,
    overviewMaxZoom: number
  },

  leaflet: {
    //! TODO: TileProvider: string,
    defZoom: number,  // or just zoom to bounds?
    markerScheme: string,
    overviewDifference: number,
    overviewMinZoom: number,
    overviewMaxZoom: number
  },

  imageDirectory: string,
  defRadioLogStatus: number,
  radioLogStatuses: RadioLogStatusType[],
  // fieldReportKeywords: string[],  // Future...could also just search notes field

  // E-103 (2026-08-26 scoping): per-mission definable checklist of routine ICS-213
  // recipients (Incident Commander, Ops Section, EOC, ...) - Entry's "To (recipient(s))"
  // renders one checkbox per entry here, plus a free-text field for anything not listed.
  // Additive-only, same reasoning as showDD/.../showMaidenhead above
  // (settings-schema-version-discipline): backfillMissingFields supplies
  // DEFAULT_RECIPIENT_OPTIONS_213 to any returning user whose stored settings predate this
  // field - no MISSION_SCHEMA_VERSION bump needed.
  recipientOptions213: string[],

  // Raised live, 2026-08-27: what a ranger's unique identifier is CALLED varies by
  // agency/region - WA uses REW, an IMT or another agency uses something else entirely, and
  // a large multi-agency incident may have several systems in play at once with no single
  // right answer. The identifier itself is still required to be unique (D-42/D-43's own
  // constraint, unchanged) - this only controls the LABEL shown for it, on the Rangers grid
  // column header and wherever else it is displayed as a field name. Additive-only, same
  // reasoning as recipientOptions213 immediately above - no MISSION_SCHEMA_VERSION bump
  // needed, backfillMissingFields supplies the default to any returning user.
  idFieldLabel: string,

  // ADR D-49 (2026-08-30): mission-editable categories for the Locations feature (Command
  // Post, Staging Area, Ranger First Aid, ...) - same indirection radioLogStatuses already
  // uses for RadioLogEntryType.status, not a second mechanism. Additive-only field, same
  // reasoning as recipientOptions213/idFieldLabel above - no MISSION_SCHEMA_VERSION bump
  // needed, backfillMissingFields supplies DEFAULT_LOCATION_TYPES to any returning user.
  locationTypes: LocationCategoryType[],

  // E-31/E-41 phase 3, piece 3 (2026-08-31): backs the Radio Log page's "since the last
  // print" scope option for printing an ICS-309 log (see `shared/export/ics309-log.ts`).
  // Genuinely optional, no default - `undefined` means "never printed on this device," a
  // legitimate and common state (a fresh mission, or one never printed from), not something
  // `backfillMissingFields` should manufacture a value for. Same "truly optional, no
  // migration needed" treatment `RadioLogEntryType.printedAt`/`revisedAt` already use.
  lastPrintedAt?: Date,

  // E-87 Stage 1 (2026-08-31): the opt-in "publish to a Command Post Server" setting the
  // roadmap's own scoping doc calls for (`E-87 Command Post Server.md`, §3 Stage 1 -
  // "one opt-in setting plus a POST-on-change"). Additive-only, same reasoning as
  // idFieldLabel/locationTypes above - no MISSION_SCHEMA_VERSION bump needed,
  // backfillMissingFields supplies the defaults (disabled, blank URL) to any returning user.
  // The roster is deliberately never part of what gets published here (see
  // command-post-publish.service.ts) - these two fields only gate WHETHER/WHERE the
  // redacted radio-log-only payload goes, they don't change what's in it.
  commandPostEnabled: boolean,
  commandPostServerUrl: string,

  // E-118 (2026-09-22): how often teams are expected to check in, in minutes. Drives the
  // overdue-escalation colour ramp on the map, the Rangers grid and the Radio Log - see
  // `shared/overdue.ts` for the band maths and why the ramp is relative to this rather than
  // fixed wall-clock minutes (a team on a 15-minute cycle is overdue long before one on a
  // 2-hour cycle). `0` means "no fixed cycle": escalation is disabled and elapsed times show
  // as plain text, which is the honest display when nobody has set a cadence.
  // Additive-only field, same reasoning as idFieldLabel/locationTypes above - no
  // MISSION_SCHEMA_VERSION bump needed, backfillMissingFields supplies
  // DEFAULT_CHECK_IN_INTERVAL_MIN to any returning user whose stored settings predate it.
  checkInIntervalMin: number,
}
