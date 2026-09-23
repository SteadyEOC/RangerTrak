
export { Utility } from "./utility"
export { AlertsComponent } from "./alerts/alerts.component"
export { BackToTopComponent } from "./back-to-top/back-to-top.component"
export { SectionComponent } from "./section/section.component"
export { HeaderComponent } from "./header/header.component"
export { PageComponent } from "./page/page.component"
export { FooterComponent } from "./footer/footer.component"
export { InstallUpdateComponent } from "./install-update/install-update.component"
export { NavbarComponent } from "./navbar/navbar.component"
export { TimePickerComponent } from './time-picker/time-picker.component'

export { LayerType, Map, MapType } from './mapping/map.interface'
export { CodeArea, OpenLocationCode } from "./mapping/open-location-code"  // HAD TO REMMOVE default KEYWORD????
export { GeocodingProvider, GeocodeResult, GEOCODING_PROVIDER } from "./mapping/geocoding-provider.interface"
export { NominatimGeocoder } from "./mapping/nominatim-geocoder"
export { GoogleGeocoder } from "./mapping/google-geocoder"
// ./mapping/map-style is deliberately NOT re-exported - see the note in mapping/index.ts.
export { DDToDMS, DDToDDM, DMSToDD, DDMToDD, DirEnum, DirType, destinationPoint } from "./mapping/coordinate"
export { AbstractMap } from "./mapping/map"
export { rangerIconFor, evidenceIconFor } from "./mapping/ranger-icon"
export { rangerColorFor, evidenceMarkerSvg } from "./mapping/ranger-marker"
export { locationIconFor } from "./mapping/location-icon"
export { locationMarkerSvg } from "./mapping/location-marker"
export { hashString } from "./mapping/hash-color"
export { radioLogStatusColor, locationCategoryColor, resolveCssColorForCanvas } from "./mapping/report-marker-status"
export { formatReportTime } from "./mapping/report-time"
export { computeExtent, ExtentPoint } from "./mapping/extent"

// !BUG: Can't find @What3Words/API - need to install it?!
// export { What3Words } from './mapping/3words'
