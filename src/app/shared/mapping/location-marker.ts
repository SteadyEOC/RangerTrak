import { LocationCategoryType, LocationIconId } from '../services'

/**
 * The Leaflet-free half of location marker drawing - `locationMarkerSvg()`, a pure string
 * function, split out of `location-icon.ts` (2026-09-02, completing F29-7/8/ADR D-49's
 * "engine-agnostic" intent) so `mapLibre.component.ts` - which touches no Leaflet API - can
 * use it without pulling the `leaflet` package into its own chunk. `location-icon.ts` still
 * owns the `L.DivIcon`-returning `locationIconFor()` for the genuinely-Leaflet consumer
 * (`mapLeaflet.component.ts`) and imports this back from here.
 *
 * Marker icons for the Locations feature (ADR D-49) - Command Post, Staging Area, Ranger
 * First Aid, and whatever else a mission adds. Deliberately hand-drawn inline SVG, not an
 * icon font/library: the same choice `ranger-marker.ts` already made for ranger/evidence
 * markers, kept consistent here rather than introducing a second way to draw a map marker.
 *
 * Shapes are loosely modelled on real NWCG (National Wildfire Coordinating Group) incident
 * symbology - a public-domain federal standard reviewed against a real IMT ops-map legend
 * (see the roadmap's "Icon-based map annotation/editing" backlog row) - not invented from
 * scratch: a flag for a command post, an "S" panel for staging, a cross for an aid station.
 * A future pass adopting the full NWCG set wholesale can replace these without changing this
 * function's signature or call sites.
 *
 * E-117 (2026-09-25): shapes are now keyed by a stable `LocationIconId`, not the mission-
 * editable category NAME - a mission can rename "Command Post" to "Main CP" without losing
 * its flag icon. `resolveLocationIcon()` below is the ONE place that turns a category (and
 * its optional `icon` field) into an id every consumer (both map engines, the Mission
 * locations list, the location dialog, the Mission > Location types grid) draws from.
 */

/**
 * E-140 "flat badge" style: a 48x48 disc in the category colour, a rim, and a 24x24 stroked
 * glyph. Letters are stroked paths, not <text>, so they draw identically on every device.
 * `fill` is only ever the validated category colour (safeMarkerColor, applied by
 * locationMarkerSvg) or a fixed constant - never raw input. The Command Post badge is fixed
 * navy and orange, matching the roster's cmd badge.
 */
const badge = (fill: string, ink: string, glyph: string) => `
  <g transform="scale(.5)" stroke="none">
    <circle cx="24" cy="24" r="22.5" fill="${fill}"/>
    <circle cx="24" cy="24" r="20.5" fill="none" stroke="${ink}" stroke-width="2"/>
    <g transform="translate(11 11) scale(1.083)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  </g>`
const GLYPH_CMD = '<path d="M3.5 20.5 12 8l8.5 12.5Z"/><path d="M10 20.5 12 16l2 4.5"/><path d="M12 8V2.5"/><path d="M14.6 3c1 .9 1 2.6 0 3.5"/><path d="M16.8 1.5c1.9 1.7 1.9 4.8 0 6.5"/>'
const GLYPH_MEDIC = '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z"/>'
const GLYPH_S = '<path d="M16 7.5c-1-1.4-2.2-2-4-2-2.3 0-3.8 1.1-3.8 2.9 0 3.9 8 2.2 8 6.9 0 1.9-1.7 3.2-4.2 3.2-1.8 0-3.2-.7-4.2-2"/>'
const GLYPH_B = '<path d="M8 4.5v15M8 4.5h4c2 0 3.2 1.2 3.2 3.2S14 11.5 12 11.5H8M12 11.5c2.3 0 3.8 1.3 3.8 4s-1.5 4-3.8 4H8"/>'
const GLYPH_C = '<path d="M16.5 8c-1-1.6-2.5-2.5-4.5-2.5-3.2 0-5 2.6-5 6.5s1.8 6.5 5 6.5c2 0 3.5-.9 4.5-2.5"/>'
const GLYPH_H = '<path d="M7.5 4.5v15M16.5 4.5v15M7.5 12h9"/>'
const GLYPH_W = '<path d="M4.5 5l3.5 14.5L12 9.5l4 10L19.5 5"/>'
const GLYPH_SAFETY = '<path d="M12 3.5 21.5 20h-19Z"/><path d="M14 12.6c-.5-.7-1.2-1-2-1-1.1 0-1.9.6-1.9 1.5 0 2 4 1.2 4 3.4 0 .9-.9 1.6-2.1 1.6-.9 0-1.6-.4-2.1-1"/>'

const SHAPES: Record<LocationIconId, (color: string) => string> = {
  'command-post': () => badge('#14191E', '#E07A2E', GLYPH_CMD),
  'staging': color => badge(color, '#FFFFFF', GLYPH_S),
  'first-aid': color => badge(color, '#FFFFFF', GLYPH_MEDIC),
  // Added 2026-08-30 alongside DEFAULT_LOCATION_TYPES' expansion (mission-migration.ts) -
  // same "letter panel" treatment as Staging Area, for the two categories with no obvious
  // pictogram of their own at this icon size.
  'eoc': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" font-family="sans-serif" fill="white">E</text>`,
  // A flame, not a letter - "F" would be too easily misread as First Aid's panel at a
  // glance, and a fire station has an obvious real pictogram unlike EOC/Dock.
  'fire-station': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <path d="M12 4c-1 3-4 4-4 8a4 4 0 0 0 8 0c0-1.5-.7-2.5-1.3-3.3.1 1-.4 1.8-1 1.8-.8 0-1-1-.7-2C13.4 7 12.6 5.5 12 4z" fill="white"/>`,
  'dock': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" font-family="sans-serif" fill="white">D</text>`,
  // E-117 additions (2026-09-25), the maintainer's own "building from vehicles from
  // outhouses" list plus the roadmap's own gap analysis (radio relay, hazard, supply point,
  // helispot). Same "coloured 22x22 panel + white pictogram" treatment as the letter panels
  // above, so the whole set reads as one family at 24px.
  'building': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <rect x="7" y="6" width="10" height="14" fill="white"/>
    <rect x="9" y="9" width="2" height="2" fill="${color}"/>
    <rect x="13" y="9" width="2" height="2" fill="${color}"/>
    <rect x="9" y="13" width="2" height="2" fill="${color}"/>
    <rect x="13" y="13" width="2" height="2" fill="${color}"/>`,
  // The "outhouse" case, named explicitly in the maintainer's own scoping note - a peaked
  // roof silhouette with the conventional crescent-moon door cutout, so it reads as a
  // portable toilet/facility rather than a generic shed at a glance.
  'toilet': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <path d="M7 20V10l5-4 5 4v10z" fill="white"/>
    <path d="M13.6 12.4a2 2 0 1 1-2.2-2.3 1.6 1.6 0 0 0 2.2 2.3z" fill="${color}"/>`,
  'vehicle': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <path d="M4 16l1-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l1 5v2H4z" fill="white"/>
    <circle cx="8" cy="18" r="1.6" fill="${color}"/>
    <circle cx="16" cy="18" r="1.6" fill="${color}"/>`,
  'vessel': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <path d="M4 15h16l-2 5H6z" fill="white"/>
    <line x1="12" y1="5" x2="12" y2="15" stroke="white" stroke-width="2"/>
    <path d="M12 6l5 6h-5z" fill="white"/>`,
  // An antenna mast plus two broadcast arcs - distinct from Command Post's flag pole at a
  // glance (no flag, and the arcs read as "signal" rather than "marker for a place").
  'radio': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <line x1="12" y1="20" x2="12" y2="8" stroke="white" stroke-width="2"/>
    <path d="M12 8l-3-4M12 8l3-4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M7.5 11.5a6.5 6.5 0 0 1 9 0" stroke="white" stroke-width="1.6" fill="none"/>
    <path d="M5 14a10 10 0 0 1 14 0" stroke="white" stroke-width="1.4" fill="none" opacity=".7"/>`,
  // A conventional warning triangle - white body, the exclamation mark punched through in
  // the panel's own color rather than drawn on top, so it stays legible at 24px.
  'hazard': color => `
    <rect x="1" y="1" width="22" height="22" rx="3" fill="${color}"/>
    <path d="M12 4l9 16H3z" fill="white"/>
    <rect x="11" y="10" width="2" height="6" fill="${color}"/>
    <rect x="11" y="17" width="2" height="2" fill="${color}"/>`,
  // E-140: ICS lettered badges (W water, H helispot, B base, C camp, S staging) - stroked paths.
  'water': color => badge(color, '#FFFFFF', GLYPH_W),
  'helispot': color => badge(color, '#FFFFFF', GLYPH_H),
  'base': color => badge(color, '#FFFFFF', GLYPH_B),
  'camp': color => badge(color, '#FFFFFF', GLYPH_C),
  'safety': color => badge(color, '#FFFFFF', GLYPH_SAFETY),
  'pin': color => GENERIC_PIN_PATH(color),
}

/** Generic pin, used for "Other" and any category with no dedicated shape above. */
const GENERIC_PIN_PATH = (color: string) => `
  <path d="M12 1c-5 0-9 3.8-9 8.5C3 16 12 23 12 23s9-7 9-13.5C21 4.8 17 1 12 1z" fill="${color}" stroke="white" stroke-width="1"/>
  <circle cx="12" cy="9.5" r="3" fill="white"/>`

/**
 * Maps every BUILT-IN category name (DEFAULT_LOCATION_TYPES, mission-migration.ts) to its
 * historical icon, preserving each one's shape exactly for a returning user whose stored
 * `LocationCategoryType` predates the `icon` field. A category name not listed here (a
 * mission-added category, or "Other") falls through to the generic pin in
 * `resolveLocationIcon()` - never a KeyError, never blank.
 */
const ICON_BY_NAME: Record<string, LocationIconId> = {
  'Command Post': 'command-post',
  'Staging Area': 'staging',
  'Ranger First Aid': 'first-aid',
  'EOC': 'eoc',
  'Fire Station': 'fire-station',
  'Dock': 'dock',
}

/**
 * The one resolution order every consumer uses (E-117) to turn a Location category into the
 * icon id its marker draws: an explicit `icon` on the category wins, then a built-in name
 * match, then the generic pin - never blank, and a returning user whose settings predate
 * `icon` sees an IDENTICAL marker to before this field existed.
 *
 * Takes the category NAME plus the mission's own `locationTypes` list, the same shape
 * `locationCategoryColor()` (report-marker-status.ts) already takes for the matching color
 * lookup - both map engines, the locations list, the location dialog and the Location types
 * grid all already have that pair in hand. A name with no matching category (renamed or
 * deleted after a location was placed, mirroring `locationCategoryColor()`'s own fallback
 * reasoning) resolves through `ICON_BY_NAME` alone.
 */
export function resolveLocationIcon(
  type: string,
  locationTypes: ReadonlyArray<LocationCategoryType>
): LocationIconId {
  const category = locationTypes.find(t => t.type === type)
  return category?.icon ?? ICON_BY_NAME[type] ?? 'pin'
}

/**
 * The raw `<svg>` markup for a resolved location icon id + its configured color
 * (`MissionType.locationTypes`). Callers resolve the bare category name to an icon id via
 * `resolveLocationIcon()` first - this function only draws, it never looks a category up -
 * so a location always draws as SOMETHING recognizable, never blank, even for a persisted
 * `icon` value this build no longer recognizes (hand-edited import, older/newer build).
 *
 * Engine-agnostic on purpose (no Leaflet import, unlike `location-icon.ts`'s
 * `locationIconFor()`): MapLibreComponent builds a `maplibregl.Marker` DOM element from this
 * same string rather than a `L.DivIcon`, so both map engines draw an identical marker from
 * one definition.
 */
export function locationMarkerSvg(icon: LocationIconId, color: string): string {
  const draw = SHAPES[icon] ?? SHAPES['pin']
  return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" stroke="white" stroke-width="1" stroke-linejoin="round">${draw(safeMarkerColor(color))}</svg>`
}

/** Used in place of any color that fails safeMarkerColor()'s check. */
const FALLBACK_MARKER_COLOR = '#757575'

/**
 * `color` comes from the mission's own settings, which can arrive in someone else's backup
 * or Mission Zip, and it is interpolated straight into markup that callers render as trusted
 * HTML (Leaflet's divIcon, MapLibre's marker element, and two `bypassSecurityTrustHtml`
 * previews). So only a hex color, a plain named color, or an rgb()/hsl() function of digits
 * gets through - nothing that could close the attribute. Anything else draws grey rather than
 * failing, so a location always still appears on the map.
 */
export function safeMarkerColor(color: string): string {
  const c = (color ?? '').trim()
  return /^#[0-9a-f]{3,8}$/i.test(c)
    || /^[a-z]{3,30}$/i.test(c)
    || /^(rgb|hsl)a?\([\d\s.,%/]+\)$/i.test(c)
    ? c : FALLBACK_MARKER_COLOR
}
