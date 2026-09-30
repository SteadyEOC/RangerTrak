import { hashString } from './hash-color'

/**
 * The Leaflet-free half of ranger/evidence marker drawing - pure functions returning a
 * color or an SVG string, no `L.DivIcon` anywhere. Split out of `ranger-icon.ts` (2026-09-02,
 * completing F29-7/8/ADR D-49's "engine-agnostic" intent) so `mapLibre.component.ts` and
 * `radio-log.component.ts` - neither of which touches Leaflet - can use these without
 * pulling the `leaflet` package into their own bundles. `ranger-icon.ts` still owns the
 * `L.DivIcon`-returning wrappers for the two genuinely-Leaflet consumers
 * (`mini-mapLeaflet.component.ts`, `mapLeaflet.component.ts`) and imports these back from here.
 *
 * E-86 (narrowed 2026-08-24: "ignore the team concept for now, just make ranger markers
 * unique"): every ranger gets a distinct marker - shape AND color, both derived purely
 * from their callsign - so the same ranger looks identical everywhere (main map, Entry
 * mini-map) and across sessions/devices, with no stored state and no roster lookup
 * needed at draw time.
 */

// Plain shape outlines, stroked white so they stay legible over any tile color
// (satellite, OpenTopoMap's greens/browns, etc.) - filled color is what varies per ranger.
export const MARKER_SHAPES: ((fill: string) => string)[] = [
  fill => `<circle cx="10" cy="10" r="8" fill="${fill}"/>`,
  fill => `<rect x="2" y="2" width="16" height="16" fill="${fill}"/>`,
  fill => `<polygon points="10,1 19,18 1,18" fill="${fill}"/>`,
  fill => `<polygon points="10,1 19,10 10,19 1,10" fill="${fill}"/>`,
  fill => `<polygon points="10,1 12.7,7.2 19.5,7.6 14.2,11.9 16.2,18.5 10,14.8 3.8,18.5 5.8,11.9 0.5,7.6 7.3,7.2" fill="${fill}"/>`,
]

/**
 * A deterministic color for a given ranger identity key - same key always yields the
 * same color, no lookup or stored assignment required. Shared by the marker fill
 * (`rangerIconFor`, ranger-icon.ts) and the route-trail stroke (`mapLeaflet.component.ts`'s
 * `drawTrails()`), so a ranger's trail and marker can never show different colors.
 *
 * `key` is `rangerUid || callsign` at every call site (D-42 phase 5) - see ranger-icon.ts's
 * header comment for why. Callers with a genuinely blank key should use `rangerIconFor`'s
 * own dedicated "unassigned" marker instead of this function - kept `|| 'Unknown'`
 * here only because `drawTrails()` still calls this directly for a trail's stroke color,
 * and a trail has no equivalent "unassigned" treatment (yet) to fall back to.
 */
export function rangerColorFor(key: string): string {
  const hash = hashString(key || 'Unknown')
  return `hsl(${hash % 360}, 65%, 42%)`
}

/**
 * 2026-09-30, John: E-152 - the inner shape markup (no wrapping <svg>) a given ranger key
 * draws, or `UNASSIGNED_MARKER` for a blank key. Pulled out of `rangerIconFor()`
 * (ranger-icon.ts) so the printed map's legend asks the very same function the marker asks,
 * rather than repeating the hash-to-shape arithmetic where it could drift out of step.
 */
export function rangerShapeMarkup(key: string): string {
  return key?.trim()
    ? MARKER_SHAPES[Math.floor(hashString(key) / 360) % MARKER_SHAPES.length](rangerColorFor(key))
    : UNASSIGNED_MARKER
}

// Fixed appearance, deliberately NOT drawn from the hash-based shape/color system above -
// a report with no callsign at all isn't "a ranger who happens to hash to this look," it's a
// data gap, and needs to read as visually different from every possible real marker, not
// just different from whichever real marker it happened to collide with. Dashed red ring
// (never used by any hashed shape's own stroke) + a literal "?" - no ambiguity about what it
// means at a glance, on a map a scribe is reading quickly under time pressure.
export const UNASSIGNED_MARKER = `<circle cx="10" cy="10" r="8" fill="#ffffff" stroke="#c0392b" stroke-width="2" stroke-dasharray="3,2"/><text x="10" y="14.5" text-anchor="middle" font-size="12" font-weight="700" fill="#c0392b" font-family="sans-serif">?</text>`

/**
 * The raw `<svg>` markup for the evidence/clue marker - a small purple flag, deliberately
 * unlike anything a ranger marker ever draws (not a hashed ranger color/shape, not the
 * red-dashed "unassigned" marker): it means one specific thing, "the evidence/clue is here,"
 * and should never be confused with a ranger position.
 *
 * Engine-agnostic on purpose (a plain string, no Leaflet type in its signature), same split
 * `location-marker.ts`'s `locationMarkerSvg()` already established: `evidenceIconFor()`
 * (ranger-icon.ts) wraps this in a Leaflet `L.DivIcon` for `mapLeaflet.component.ts`;
 * `mapLibre.component.ts` builds a `maplibregl.Marker` DOM element from this same string
 * directly, so both engines draw the identical marker from one definition instead of two
 * that could drift apart.
 */
export function evidenceMarkerSvg(): string {
  return `<svg width="22" height="26" viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg">
      <line x1="3" y1="25" x2="3" y2="2" stroke="#7c3aed" stroke-width="2"/>
      <polygon points="3,2 20,7 3,13" fill="#7c3aed" stroke="white" stroke-width="1"/>
    </svg>`
}
