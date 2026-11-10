/**
 * The one test every map uses before drawing a coordinate: returns `[lat, lng]` as numbers,
 * or `undefined` when the point has no usable fix.
 *
 * Why it exists: since Leaflet 2.0.0-beta.3, `LatLng` (and so every `Marker`, `Circle` and
 * `LatLngBounds` built from data) THROWS on a coordinate that is not a number or a numeric
 * string. Before, `null` and `''` quietly became 0 and a missing one became NaN, so a bad
 * imported row drew a pin at 0,0 or nothing. Now one bad row would stop the whole marker loop,
 * so the map would show none of the reports after it.
 *
 * Accepts what Leaflet's `LatLng.validate()` accepts (numbers and non-blank numeric strings),
 * minus non-finite values, and keeps RangerTrak's own long-standing rule that a 0 latitude or
 * longitude means "no fix" (the old `lat && lng` guard). map-point.spec.ts checks every
 * accepted value against `LatLng.validate()` so the two cannot drift apart.
 *
 * Deliberately does NOT import Leaflet: heat-points.ts uses it, and the print legend imports
 * heat-points eagerly (see tools/check-eager-bundle.js).
 */
export function mapPoint(p: { lat?: unknown, lng?: unknown } | null | undefined): [number, number] | undefined {
  if (!p) return undefined
  const lat = toCoord(p.lat)
  const lng = toCoord(p.lng)
  return lat && lng ? [lat, lng] : undefined
}

/** Leaflet's own `Util.toNumber` rule, plus finite. NaN, 0 and Infinity all come back falsy-or-0. */
function toCoord(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? +v : NaN
  return Number.isFinite(n) ? n : 0
}
