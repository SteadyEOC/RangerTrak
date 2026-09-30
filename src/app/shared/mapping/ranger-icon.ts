import * as L from 'leaflet'

import { rangerShapeMarkup, evidenceMarkerSvg } from './ranger-marker'

/**
 * The Leaflet half of ranger/evidence marker drawing - `L.DivIcon` wrappers around
 * `ranger-marker.ts`'s pure color/SVG functions. Only `mini-mapLeaflet.component.ts` and
 * `mapLeaflet.component.ts` (both genuinely Leaflet-based) import from this file; anything
 * that just needs a color or an SVG string (`mapLibre.component.ts`, `radio-log.component.ts`)
 * imports from `ranger-marker.ts` instead, so the `leaflet` package (2026-09-02: previously
 * ~146KB, present in Entry's own initial bundle per a live PageSpeed "unused JavaScript"
 * finding) no longer follows those two into their own chunks. See `ranger-marker.ts`'s
 * header comment for the full split rationale (F29-7/8, ADR D-49).
 *
 * ADR D-42 phase 5 (2026-08-25): callers used to pass `callsign` directly. Two DIFFERENT
 * rangers with no callsign - the population D-42 exists to serve - hashed to the identical
 * empty string, so their markers (and, via `drawTrails()`'s matching grouping key, their
 * trails) were indistinguishable. Callers now pass `rangerUid || callsign`: `rangerUid` is
 * the surrogate key (ADR D-42) and is unique whenever it's set, so it's preferred; `callsign`
 * remains the fallback for reports with no `rangerUid` (pre-migration data, or a callsign
 * that matched no current roster row). Only when BOTH are blank does a report fall through
 * to `UNASSIGNED_MARKER` - genuinely no data to distinguish it by.
 */

/**
 * A deterministic, distinct Leaflet icon for a given ranger identity key - same key
 * always yields the same shape+color, no lookup or stored assignment required. Shape and
 * color are derived from independent bit ranges of one hash, so the two don't visibly
 * correlate (two rangers sharing a color won't reliably also share a shape).
 *
 * `key` is `rangerUid || callsign` at every call site (D-42 phase 5 - see this file's
 * header comment). Originally hashed `callsign` directly: a genuinely blank callsign used
 * to fall through to `hashString('Unknown')`, so EVERY report with no callsign got the
 * identical shape+color - not just "as ambiguous as before," but actively worse, since two
 * DIFFERENT callsignless rangers' reports then looked like one consistent identity moving
 * around (and, via `drawTrails()`'s matching key, could be joined into one bogus trail
 * between them). Keying on `rangerUid` when it's set fixes that: it's the surrogate key,
 * unique per ranger regardless of callsign. Only a key that's blank even after that fallback
 * (no `rangerUid` AND no `callsign`) routes to the fixed `UNASSIGNED_MARKER` - genuinely no
 * data left to distinguish it by.
 *
 * `statusColor` (raised live, 2026-08-26): an optional halo drawn BEHIND the ranger's own
 * shape, so a report's configured status (Normal/Need Rest/Urgent/...) reads at a glance on
 * the map without opening the popup - the same color the Mission page's status editor and
 * the Entry/Reports status controls already use (`radioLogStatusColor()`, this module's
 * sibling file), not a second palette. A real SVG circle behind the shape rather than a CSS
 * `filter: drop-shadow(...)` - Leaflet's `divIcon` container is sized exactly to `iconSize`
 * (no guaranteed overflow room for a blurred filter to bleed into without clipping), where
 * an SVG element drawn inside a larger viewBox has no such risk. Omitted entirely (falls
 * back to the plain 20x20 icon) when no status color resolves, so a report with an unknown/
 * blank status draws exactly as it always has.
 */
export function rangerIconFor(key: string, statusColor?: string): L.DivIcon {
  const shape = rangerShapeMarkup(key)

  if (!statusColor) {
    return L.divIcon({
      className: 'rt-ranger-marker',
      html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" stroke="white" stroke-width="1" stroke-linejoin="round">${shape}</svg>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    })
  }

  // Halo sits in its own 28x28 viewBox with the shape's original 0-20 coordinate system
  // shifted +4/+4 via <g transform>, so MARKER_SHAPES' own path/point coordinates need no
  // change to support this.
  return L.divIcon({
    className: 'rt-ranger-marker',
    html: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="13" fill="${statusColor}" opacity="0.55"/>
      <g transform="translate(4,4)" stroke="white" stroke-width="1" stroke-linejoin="round">${shape}</g>
    </svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

/**
 * Originally defined only inline in `mini-mapLeaflet.component.ts` (Entry's own preview map,
 * 2026-08-26). E-11 (2026-08-26, "shown nowhere except Entry's own mini-map" gap): extracted
 * here so the main Leaflet map (`mapLeaflet.component.ts`) draws the IDENTICAL marker for a
 * `RadioLogEntryType.evidenceLocation` rather than inventing a second look for the same
 * meaning - a scribe who has seen it once on Entry should recognize it instantly on the
 * mission overview too.
 */
export function evidenceIconFor(): L.DivIcon {
  return L.divIcon({
    className: 'rt-evidence-marker',
    html: evidenceMarkerSvg(),
    iconSize: [22, 26],
    iconAnchor: [3, 25],
  })
}
