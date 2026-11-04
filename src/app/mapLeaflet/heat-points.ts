// 2026-11-03, John: E-274 - the pure part of the heat map overlay, kept apart from the map
// component (and from the lazy-loaded leaflet.heat plugin) so it can be unit tested.

/**
 * Opacity of the whole heat pane (0..1): the single place to tune how strongly the heat shows over
 * the map. 2026-11-04, John ("too transparent"): 0.5 -> 0.85, with HEAT_OPTIONS below.
 */
export const HEAT_OPACITY = 0.85

/**
 * leaflet.heat options (2026-11-04). Its defaults suit thousands of points; a mission has dozens.
 * - maxZoom 14: the plugin halves each point's weight for every zoom level below maxZoom (default:
 *   the map's max, 19), so at a field zoom of 17 a report counted a quarter. At 14 and closer it
 *   now counts in full.
 * - max 2: two reports on the same spot reach the hot end of the colours (default 1 left nothing
 *   between "one report" and "red").
 * - minOpacity 0.35: the faintest point still shows when zoomed well out (default 0.05).
 */
export const HEAT_OPTIONS = { radius: 25, blur: 15, maxZoom: 14, max: 2, minOpacity: 0.35 } as const

/**
 * One [lat, lng] point per radio log entry that has a location. Every entry weighs the same.
 * Same test as the markers use (`location.lat && location.lng`), so what is hot is what is pinned.
 */
export function heatPoints(entries: readonly { location?: { lat: number, lng: number } }[]): [number, number][] {
  const points: [number, number][] = []
  for (const e of entries) {
    if (e.location?.lat && e.location?.lng) points.push([e.location.lat, e.location.lng])
  }
  return points
}
