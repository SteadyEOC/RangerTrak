import * as L from 'leaflet'

import { LocationIconId } from '../services'
import { locationMarkerSvg } from './location-marker'

/**
 * The Leaflet half of location marker drawing - `L.DivIcon` wrapper around
 * `location-marker.ts`'s pure `locationMarkerSvg()`. Only `mapLeaflet.component.ts`
 * (genuinely Leaflet-based) imports from this file; `mapLibre.component.ts` imports
 * `locationMarkerSvg` from `location-marker.ts` directly instead, so the `leaflet` package
 * no longer follows it into its own chunk. See `location-marker.ts`'s header comment for
 * the full split rationale (F29-7/8, ADR D-49).
 *
 * Takes an already-resolved icon id (E-117), not a bare category name - the caller resolves
 * via `resolveLocationIcon()` first, same as `locationMarkerSvg()` itself now expects.
 */
export function locationIconFor(icon: LocationIconId, color: string): L.DivIcon {
  return L.divIcon({
    className: 'rt-location-marker',
    html: locationMarkerSvg(icon, color),
    iconSize: [24, 24],
    iconAnchor: [12, 22],
    popupAnchor: [0, -20],
  })
}
