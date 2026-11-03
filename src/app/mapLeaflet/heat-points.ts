// 2026-11-03, John: E-274 - the pure part of the heat map overlay, kept apart from the map
// component (and from the lazy-loaded leaflet.heat plugin) so it can be unit tested.

/** Opacity of the whole heat pane (0..1): the single place to tune how strongly the heat shows over the map. */
export const HEAT_OPACITY = 0.5

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
