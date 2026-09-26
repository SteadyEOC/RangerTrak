// OK to use this, but... means we have to keep it AND../ index.ts updated: worth it
// Mapps & location library interfaces
export { LayerType, Map, MapType } from './map.interface'
export { CodeArea, OpenLocationCode } from "./open-location-code"  // HAD TO REMMOVE default KEYWORD????
export { GeocodingProvider, GeocodeResult, GEOCODING_PROVIDER } from "./geocoding-provider.interface"
export { NominatimGeocoder } from "./nominatim-geocoder"
export { GoogleGeocoder } from "./google-geocoder"
// NOTE: ./map-style is deliberately NOT re-exported here (nor from ../index.ts). It pulls
// in MapLibre (~800KB), and anything importing this barrel for an unrelated symbol would
// drag MapLibre along with it into the eager bundle. Its consumer, MapLibreComponent, imports it
// directly from './mapping/map-style' instead, which keeps MapLibre inside the lazily-loaded
// /map route chunk. (E-70: the unwired MiniMapComponent, formerly a second consumer, is gone.)
export { DDToDMS, DDToDDM, DMSToDD, DDMToDD, DirEnum, DirType, destinationPoint } from "./coordinate"
export { AbstractMap } from "./map"
export { rangerIconFor } from "./ranger-icon"
export { rangerColorFor, evidenceMarkerSvg } from "./ranger-marker"
export { locationIconFor } from "./location-icon"
export { locationMarkerSvg, resolveLocationIcon } from "./location-marker"
export { hashString } from "./hash-color"
export { radioLogStatusColor, locationCategoryColor, resolveCssColorForCanvas } from "./report-marker-status"
export { computeExtent, ExtentPoint } from "./extent"
