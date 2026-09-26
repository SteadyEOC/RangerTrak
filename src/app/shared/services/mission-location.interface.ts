/**
 * ADR D-49 (2026-08-30): the first of the People/Teams/Facilities split (D-45) to actually
 * ship - renamed from "Facilities" to "Locations" per the maintainer's own live wording.
 * Teams is still deferred; this covers named, fixed points on the map for a mission -
 * Command Post, Staging Area, Ranger First Aid, and whatever else a mission needs, none of
 * which are rangers and none of which are field reports.
 *
 * Scoped PER-MISSION, same as RangerType - there is no operational-period partitioning
 * anywhere in this app today (opPeriod/opPeriodStart/opPeriodEnd are plain display fields on
 * MissionType, nothing scopes data by them), so this does not invent one either. See the
 * live design discussion recorded in `Architectural Decision Record.md`'s D-49 for why.
 */

/**
 * The pictogram a Location category's marker draws, on top of its `color` (E-117,
 * 2026-09-25). Purpose-drawn inline SVG only (`shared/mapping/location-marker.ts`'s
 * `SHAPES`) - no raster, no icon font/library, matching the choice `ranger-marker.ts`
 * already made for ranger/evidence markers.
 *
 * Kept here, next to `LocationCategoryType`, rather than in the mapping module: this is
 * part of the PERSISTED shape (a mission's `locationTypes` list), while `location-marker.ts`
 * owns the drawing (SHAPES) and resolution (`ICON_BY_NAME`, `resolveLocationIcon()`) that
 * turn an id into pixels. Adding a new id means updating both files' SHAPES/switch and this
 * union - the compiler catches a mismatch either way.
 */
export type LocationIconId =
  | 'command-post' | 'staging' | 'first-aid' | 'eoc' | 'fire-station' | 'dock'
  | 'building' | 'toilet' | 'vehicle' | 'vessel' | 'radio' | 'hazard' | 'water' | 'helispot'
  | 'pin'

/**
 * Every `LocationIconId`, in picker order, paired with the human label the Mission > Location
 * types grid's Icon column shows (E-117). The order here is display order only - it carries
 * no meaning for `resolveLocationIcon()`, which looks values up by id, not position.
 */
export const LOCATION_ICON_OPTIONS: ReadonlyArray<{ id: LocationIconId, label: string }> = [
  { id: 'command-post', label: 'Command Post' },
  { id: 'staging', label: 'Staging Area' },
  { id: 'first-aid', label: 'First Aid' },
  { id: 'eoc', label: 'EOC' },
  { id: 'fire-station', label: 'Fire Station' },
  { id: 'dock', label: 'Dock' },
  { id: 'building', label: 'Building' },
  { id: 'toilet', label: 'Portable Toilet / Facility' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'vessel', label: 'Vessel' },
  { id: 'radio', label: 'Radio Station / Relay' },
  { id: 'hazard', label: 'Hazard' },
  { id: 'water', label: 'Water / Supply Point' },
  { id: 'helispot', label: 'Helispot / Landing Zone' },
  { id: 'pin', label: 'Generic Pin' },
]

/**
 * A mission-configured category of location - Command Post, Staging Area, Ranger First Aid,
 * Other, etc. Mirrors RadioLogStatusType's shape (a name plus a color, mission-editable).
 *
 * `icon` is OPTIONAL and additive (E-117, 2026-09-25, no schema bump - see mission-migration.ts's
 * MISSION_SCHEMA_VERSION comment): a category with no `icon` still draws a marker, resolved
 * by name against `ICON_BY_NAME` in `shared/mapping/location-marker.ts` (falling back to the
 * generic pin), so a returning user's stored settings render identically to before this
 * field existed. See that module's `resolveLocationIcon()` for the one resolution order every
 * consumer uses.
 */
export type LocationCategoryType = {
  type: string,
  color: string,
  icon?: LocationIconId,
}

/**
 * One named, located point on the mission - a Command Post, a Staging Area, an aid station.
 *
 * `uid` mirrors RangerType's surrogate-key pattern (ADR D-42/D-43): app-minted, never shown,
 * never edited, guaranteed present after migration. Nothing joins reports to a location yet
 * (that is a later pass, not this one), but the key exists now so that join is additive
 * later rather than a breaking change to this shape.
 *
 * `type` stores the category NAME (a string), resolved against the mission's own
 * `locationTypes` list for its color - same indirection RadioLogEntryType.status uses against
 * radioLogStatuses, not a second enum to keep in sync.
 */
export type MissionLocationType = {
  uid?: string,
  name: string,
  type: string,
  lat: number,
  lng: number,
  address?: string,
  note?: string,
}
