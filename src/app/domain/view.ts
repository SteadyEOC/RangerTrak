/**
 * E-207 / ADR D-62 (2026-10-19, John): Simple view and Full view. ONE list of what is advanced,
 * decided in one place. Pure rules - no Angular, Leaflet, DOM or storage imports (src/app/domain/
 * is for exactly that) - so the spec can run every case without a browser. The service
 * (shared/services/view.service.ts) gathers the context and keeps the view; components only ask
 * `ViewService.isShown(id)`.
 *
 * The rule everything follows: a control is hidden ONLY when the view is Simple AND the mission
 * does not use it ("uses it" = non-empty or not at its default). Hiding never clears, resets or
 * saves anything. Warnings, alerts, readiness (D-32), backup and storage-protection status never
 * appear in this list, so they always show. Field mode (E-114) is a separate, stricter setting.
 */
export type AppView = 'simple' | 'full'

/** Where the current view came from. `user` and `setup` are never overridden by a later suggestion. */
export type ViewSource = 'default' | 'upgrade' | 'setup' | 'user'

/**
 * What the rules may look at. Plain numbers and booleans, assembled by ViewService from the
 * services the app already has, so this file needs no knowledge of them.
 */
export type ViewContext = {
  /** The radio log status list differs from the default list. */
  statusesCustomised: boolean,
  /** The location category list differs from the default list. */
  locationCategoriesCustomised: boolean,
  /** Mission locations (places). */
  locationCount: number,
  /** Geocoding key set, or any map setting (zoom defaults) not at its default. */
  mapSettingsCustomised: boolean,
  /** Listed ICS-213 recipients differ from the default list, or auto-print / extra copies are set. */
  recipientsCustomised: boolean,
  /** Tactical call signs on the mission. */
  tacticalCallCount: number,
  /** The RangerTrak Board is switched on or has an address. */
  boardInUse: boolean,
  /** Live attachments on the mission's radio log entries. */
  attachmentCount: number,
  /** Device encryption is on. */
  encryptionOn: boolean,
  /** This device is a field phone (E-114). */
  fieldMode: boolean,
  /** Radio log entries whose source is not the default. */
  nonDefaultSourceCount: number,
  /** Radio log entries with a To station. */
  toStationCount: number,
  /** Radio log entries with an evidence location. */
  evidenceLocationCount: number,
  /** Layers loaded on this device (people and places). */
  layerCount: number,
  /** The alternative map engine (MapLibre) is the one showing. */
  mapEngineIsAlternative: boolean,
  /** An extra map layer (grid, range rings, satellite, hiking trails) is switched on. */
  mapExtraLayersOn: boolean,
  /** ICS-214 activity lines on the mission (E-04 / D-63). */
  activityLineCount: number,
  /** The person asked for the Setup file by link (/prep, /mission#setup-file): a link must never land on nothing. */
  setupFileAsked: boolean,
}

export type AdvancedFeature = {
  /** Stable kebab-case id. Docs, help and e2e read these. */
  id: string,
  label: string,
  /** True when the mission uses this, so Simple view must show it. */
  isInUse: (ctx: ViewContext) => boolean,
}

const never = () => false

export const ADVANCED_FEATURES: ReadonlyArray<AdvancedFeature> = [
  // Navigation
  // E-258: Debug mode is gone; the Log section on Help > Contact us is always shown, but the id
  // stays so the Simple-view rules and docs that name it keep working.
  { id: 'debug-log', label: 'Diagnostic log', isInUse: never },
  // Mission page
  { id: 'statuses', label: 'Radio log statuses', isInUse: ctx => ctx.statusesCustomised },
  { id: 'location-categories', label: 'Place categories', isInUse: ctx => ctx.locationCategoriesCustomised },
  { id: 'locations-list', label: 'Places', isInUse: ctx => ctx.locationCount > 0 },
  { id: 'maps', label: 'Maps and geocoding', isInUse: ctx => ctx.mapSettingsCustomised },
  { id: 'recipients213', label: 'Listed message recipients', isInUse: ctx => ctx.recipientsCustomised },
  { id: 'tactical-calls', label: 'Tactical call signs', isInUse: ctx => ctx.tacticalCallCount > 0 },
  { id: 'board', label: 'RangerTrak Board', isInUse: ctx => ctx.boardInUse },
  { id: 'attachments-budget', label: 'Attachments budget', isInUse: ctx => ctx.attachmentCount > 0 },
  { id: 'setup-file', label: 'Setup file', isInUse: ctx => ctx.setupFileAsked },
  { id: 'device-encryption', label: 'Device encryption', isInUse: ctx => ctx.encryptionOn },
  { id: 'advanced-debug', label: 'Field phone card', isInUse: ctx => ctx.fieldMode },
  { id: 'field-phone', label: 'Field phone', isInUse: ctx => ctx.fieldMode },
  // Entry
  { id: 'stations', label: 'From and To station', isInUse: ctx => ctx.tacticalCallCount > 0 || ctx.toStationCount > 0 },
  { id: 'source', label: 'Source', isInUse: ctx => ctx.nonDefaultSourceCount > 0 },
  { id: 'coord-format', label: 'Coordinate format picker', isInUse: never },
  { id: 'attachments', label: 'Attachments', isInUse: ctx => ctx.attachmentCount > 0 },
  { id: 'evidence-location', label: 'Evidence location', isInUse: ctx => ctx.evidenceLocationCount > 0 },
  // Map
  { id: 'maplibre', label: 'Alternative map', isInUse: ctx => ctx.mapEngineIsAlternative },
  { id: 'map-layers-extra', label: 'Extra map layers', isInUse: ctx => ctx.mapExtraLayersOn },
  { id: 'print-map', label: 'Print map', isInUse: never },
  { id: 'places-import', label: 'Places import and export', isInUse: ctx => ctx.locationCount > 0 },
  // Navigation (E-04 / D-63 item 7): After action, the page that holds the ICS-214 log. Not on the
  // menu otherwise (reached from the AAR/214 box); Simple view lists it once the mission has a line.
  { id: 'after-action', label: 'After action (ICS-214 log)', isInUse: ctx => ctx.activityLineCount > 0 },
  // Rangers & Teams
  { id: 'layers-panel', label: 'Import, export and print layers', isInUse: ctx => ctx.layerCount > 1 },
]

/**
 * Whether a control shows. Full shows everything. An unknown id shows (a typo must never hide a
 * control). In Simple it shows only while the mission uses it.
 */
export function isShown(id: string, view: AppView, ctx: ViewContext): boolean {
  if (view === 'full') return true
  const feature = ADVANCED_FEATURES.find(f => f.id === id)
  return !feature || feature.isInUse(ctx)
}

/**
 * The view to start in when the device has no stored choice. A device that already holds mission
 * data starts in Full, so nobody upgrading loses sight of controls they were using (D-62 item 5);
 * a new install starts in Simple. Either way the caller stores it at once so it never flips later.
 */
export function initialView(i: { stored: AppView | null, hasMissionData: boolean }): { view: AppView, source: ViewSource } | null {
  if (i.stored) return null
  return i.hasMissionData ? { view: 'full', source: 'upgrade' } : { view: 'simple', source: 'default' }
}

/**
 * A Setup file's suggested view (D-62 item 6). Applies only while the device has no choice of its
 * own: the source is still `default` or `upgrade`. Applying it records `setup`, so it is applied
 * once and never over `setup` or `user`. Returns null when it should be ignored.
 */
export function applySuggestedView(i: { suggested: unknown, source: ViewSource | null }): { view: AppView, source: ViewSource } | null {
  if (i.suggested !== 'simple' && i.suggested !== 'full') return null
  if (i.source !== 'default' && i.source !== 'upgrade') return null
  return { view: i.suggested, source: 'setup' }
}

/**
 * Whether a control wears the "Advanced" marker: in Full view, every control Simple view can hide
 * (whether or not this mission happens to use it), so core and extra stay visible at a glance.
 */
export function isAdvanced(id: string, view: AppView): boolean {
  return view === 'full' && ADVANCED_FEATURES.some(f => f.id === id)
}
