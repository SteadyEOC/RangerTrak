

// also: https://github.com/onthegomap/planetiler
//import { openDB, deleteDB, wrap, unwrp } from 'idb'
// Leaflet must be *evaluated* before leaflet.markercluster: the plugin is old-style and
// reads the global `L` at module-evaluation time ("L is not defined" otherwise). This bare
// side-effect import guarantees that, and sorts ahead of the plugin alphabetically so
// import-sort cannot undo it. It used to work only by accident, via the eager
// `import L from 'leaflet'` that RadioLogService no longer has.
import 'leaflet'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../shared/overdue'
import 'leaflet.markercluster'
import {
  getStorageInfo, getStoredTilesAsJson, getTilePoints, savetiles, tileLayerOffline
} from 'leaflet.offline' // https://github.com/allartk/leaflet.offline
import type { SaveStatus } from 'leaflet.offline'
//import { markerClusterGroup } from 'leaflet'
import * as L from 'leaflet'
import { removeLeafletMap } from '../shared/mapping/leaflet-teardown'

//import pc from 'picocolors' // https://github.com/alexeyraspopov/picocolors
import { Subscription, throwError } from 'rxjs'

import { DOCUMENT, NgTemplateOutlet } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit, Component, ElementRef, Inject, Input, OnDestroy, OnInit, TemplateRef, ViewChild,
  ChangeDetectionStrategy, signal
} from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatDialog } from '@angular/material/dialog'
import { MatIconModule } from '@angular/material/icon'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'

import {
  AbstractMap, Utility, rangerIconFor, rangerColorFor, evidenceIconFor, radioLogStatusColor,
  locationCategoryColor, locationIconFor, formatReportTime, computeExtent, ExtentPoint
} from '../shared'
import { DDToUTM, UTMToDD } from '../shared/mapping/coordinate'
import {
  RadioLogService, RadioLogEntryType, LocationType, LogService, MissionLocationService,
  MissionLocationType, RangerService, MissionService
} from '../shared/services'
import { LocationDialogComponent } from '../map/location-dialog/location-dialog.component'


// https://www.digitalocean.com/community/tutorials/angular-angular-and-leaflet
// Markers are copied into project via virtue of angular.json: search it for leaflet!!!

// TODO: Add heatmap: https://www.patrick-wied.at/static/heatmapjs/example-heatmap-leaflet.html

const iconRetinaUrl = 'assets/icons/marker-icon-2x.png'
const iconUrl = 'assets/icons/marker-icon.png'
const shadowUrl = 'assets/icons/marker-shadow.png'
const iconDefault = L.icon({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
})
L.Marker.prototype.options.icon = iconDefault;

// Offline-area sizing (roadmap: "Offline map area: saved-file sizes, anticipated MB").
// Real tile bytes aren't known until a tile is actually downloaded, so the "anticipated"
// number falls back to this - a typical 256px OSM PNG raster tile - until at least one real
// tile has been saved, at which point the average of what's actually stored is used instead.
const FALLBACK_TILE_BYTES = 15 * 1024

// Offline map coverage scoping (2026-09-14, §7 Q7 - no answer from John, so this ships the
// doc's own recommended default as one named constant, easy to change later without hunting
// through _saveTiles()'s call site): a scribe who saves "the current zoom" alone gets blank
// tiles the moment they zoom in one level offline (leaflet.offline's savetiles control saves
// ONLY `[map.getZoom()]` when neither `zoomlevels` nor `saveWhatYouSee` is passed - confirmed
// reading ControlSaveTiles.ts's own `_calculateTiles()`). Saving a couple of deeper levels
// too costs roughly 4x/8x the tiles (each level ~4x the last) but survives a scribe zooming
// in to check an address once offline.
const LEAFLET_SAVE_EXTRA_ZOOM_LEVELS = 2

// Same decision: refuse a save above this many tiles rather than silently hammering
// OpenTopoMap's volunteer-run tile servers (whose own usage policy asks that mass downloads
// not overload it) - see the confirm() callback passed to savetiles() below. A scribe who
// hits this is told to zoom in and save a smaller area instead.
const LEAFLET_SAVE_TILE_CAP = 5000

/** The zoom levels a "Save this area" press should cover: the level the scribe is looking
 *  at now, plus up to LEAFLET_SAVE_EXTRA_ZOOM_LEVELS deeper ones, never past the active base
 *  layer's own maxZoom (OpenTopoMap tops out at 17; asking past a layer's real tile-
 *  generation limit just returns blank tiles, so there is nothing to gain saving them). */
function zoomLevelsForSave(currentZoom: number, layerMaxZoom: number): number[] {
  const top = Math.min(currentZoom + LEAFLET_SAVE_EXTRA_ZOOM_LEVELS, layerMaxZoom)
  const levels: number[] = []
  for (let zoom = currentZoom; zoom <= top; zoom++) {
    levels.push(zoom)
  }
  return levels
}

// E-item, raised 2026-08-27 comparing against a real IMT wildfire ops map: a mile grid
// overlay, same as that map's own township/range-style reference lines. A UTM-based grid,
// not a lat/lng graticule - degrees of longitude aren't a fixed distance (they shrink toward
// the poles), so a lat/lng grid can't be spaced in real miles the way this one is. Reuses
// this app's own DDToUTM/UTMToDD (Sprint H) rather than adding a second projection library.
const MILE_METERS = 1609.344

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

@Component({
  selector: 'rangertrak-mapLeaflet',
  standalone: true,
  imports: [NgTemplateOutlet, MatSlideToggleModule, MatButtonModule, MatIconModule],
  templateUrl: './mapLeaflet.component.html',
  styleUrls: [
    './mapLeaflet.component.scss'
    //,     "../../../node_modules/leaflet.markercluster/dist/MarkerCluster.css", // REVIEW: also added to angular.json: needed there?
    // "../../../node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css" // (not needed if you use your own iconCreateFunction instead of the default one)
    //'../../../node_modules/leaflet/dist/leaflet.css' // only seems to work when embedded in angular.json & Here! (chgs there REQUIRE restart!)
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  // Deliberately NOT providing MissionService: it is providedIn:'root' and a second
  // instance here would diverge from everyone else's. See BUG-2 in entry.component.ts.
})
export class LmapComponent extends AbstractMap implements OnInit, AfterViewInit, OnDestroy {  //OnInit,



  public override id = 'Leaflet Map Component'

  // Owned and templated by MapPageComponent (the page shell) - this component only decides
  // WHERE in its own layout to render it (see the template, right before Instructions).
  // See map-page.component.html's own comment for why: state/handler live in one place,
  // placement is each engine's call.
  @Input() engineSwitchTemplate?: TemplateRef<unknown>

  // static: true - these divs sit in the template unconditionally, so the query resolves
  // before ngOnInit, which is where the maps are built. Resolved from this component's own
  // view rather than by DOM id: Leaflet looks a string container up globally, and three map
  // components once all used id="map". See D-30.
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>
  @ViewChild('overviewContainer', { static: true }) private overviewContainer!: ElementRef<HTMLDivElement>
  @ViewChild('offlineControlsHost', { static: true }) private offlineControlsHost!: ElementRef<HTMLDivElement>

  private lMap!: L.Map
  private overviewMapLeaflet!: L.Map

  // TODO: Leaflet's version of following?
  overviewMapLeafletType = { cur: 2, types: { type: ['roadmap', 'terrain', 'satellite', 'hybrid',] } }

  // Removed 2026-09-22: the `mapCursor` L.icon pointed at assets/icons/my-icon.png, which
  // has never existed in this repo, and its only use was a commented-out L.marker() call.

  myMarkerCluster = new window.L.MarkerClusterGroup()
  // E-80 phase 1: per-callsign route trails, static (no animation/timer - see the roadmap
  // scoping). A plain layer group, not clustered - clustering exists to collapse crowded
  // point markers and would be actively wrong for line geometry.
  myTrailsLayer = L.layerGroup()
  // Mile grid overlay (see MILE_METERS' own comment) - redrawn on pan/zoom by
  // refreshMileGrid(), only while this layer is actually checked on in the layers control.
  mileGridLayer = L.layerGroup()
  mapOptions = ""

  // ADR D-49: Locations (Command Post, Staging Area, Ranger First Aid, ...). A plain layer
  // group, not clustered - locations are few and named, unlike field-report markers, so
  // collapsing them into a cluster bubble would hide the exact thing a scribe opened the map
  // to find. `locations` is cached from the subscription below and redrawn in full on every
  // change, same "redraw from scratch" reasoning displayMarkers() already documents for
  // field reports - cheap enough at the count a mission's own location list ever reaches.
  private locationsLayer = L.layerGroup()
  private locations: MissionLocationType[] = []
  private locationsSubscription!: Subscription

  // Armed by the "Add Location" button (template) - the NEXT plain map click places a
  // location there instead of copying coordinates (onMouseClick, below), then disarms
  // itself. One-shot, same "click, done" shape as the mini-map's Alt+click-for-evidence
  // gesture, rather than a persistent mode a scribe could forget is still on.
  placingLocation = signal(false)

  //markerClusterGroup: L.MarkerClusterGroup // MarkerClusterGroup extends FeatureGroup, retaining it's methods, e.g., clearLayers() & removeLayers()
  //markerClusterData = []

  //!TODO: Add fullscreen button: https://tomik23.github.io/leaflet-examples/#27.fullscreen

  constructor(
    missionService: MissionService,
    radioLogService: RadioLogService,
    httpClient: HttpClient,
    log: LogService,
    private rangerService: RangerService,
    private locationService: MissionLocationService,
    private dialog: MatDialog,
    @Inject(DOCUMENT) protected override document: Document
  ) {
    super(missionService,
      radioLogService,
      httpClient,
      log,
      document)

    this.log.verbose(`Constructing Leaflet Map, using https://www.LeafletJS.com version ${L.version}`, this.id)

    this.hasOverviewMap = true
    this.displayReports = true
    this.hasSelectedReports = true

    // this.markerClusterGroup = L.markerClusterGroup({ removeOutsideVisibleBounds: true });

    // Cached here (constructor, same as AbstractMap's own mission/field-report
    // subscriptions above via super()) rather than only read on demand: the ReplaySubject(1)
    // replays synchronously, but `this.lMap` doesn't exist yet at that point - refreshLocation
    // Markers() guards on it and ngOnInit calls it again once the map is actually built.
    this.locationsSubscription = this.locationService.getLocationsObserver().subscribe({
      next: (newLocations) => {
        this.locations = newLocations
        this.refreshLocationMarkers()
      },
      error: (e) => this.log.error(`Locations subscription error: ${e}`, this.id)
    })
  }

  // override ngOnInit() {
  //   super.ngOnInit()
  //   this.log.excessive("ngOnInit()", this.id)
  // }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  override ngOnInit() {
    super.ngOnInit()
    this.log.excessive("ngOnInit()", this.id)

    this.initMainMap()  //! REVIEW: Causes LOTS of "mapLeaflet:1 Uncaught (in promise) {message: 'A listener indicated an asynchronous response by r…age channel closed before a response was received'}" May need to wait, or ?????

    this.lMap.addLayer(this.locationsLayer)
    this.refreshLocationMarkers()

    if (this.hasOverviewMap) {
      this.initOverviewMap()

      // Highlight main map location via a rectangle on the overview map
      let rectangle = L.rectangle(this.lMap.getBounds(), { color: 'Blue', fillOpacity: 0.07, weight: 1 })
      rectangle.addTo(this.overviewMapLeaflet)

      this.lMap.on("move", () => {
        //if (this.overviewMapLeaflet instanceof L.Map) {
        this.overviewMapLeaflet.setView(this.lMap.getCenter()!,
          this.clamp(
            this.lMap.getZoom() -
            (this.settings.leaflet.overviewDifference),
            (this.settings.leaflet.overviewMinZoom),
            (this.settings.leaflet.overviewMaxZoom)
          ))
        rectangle.setBounds(this.lMap.getBounds())
      }
        //}
      )
    }

    if (this.displayReports && this.radioLog) {
      // updateRadioLog() first: it is what fills displayedRadioLogEntries for
      // the current all/selected choice, and displayMarkers() draws from that.
      this.updateRadioLog()
      this.displayMarkers()
      // Re-enabled: bounds used to be a Leaflet LatLngBounds that arrived from
      // localStorage as a plain object, so this threw "Bounds are not valid" and was
      // commented out - leaving markers off-screen on open. It is now a plain
      // BoundsType, converted to Leaflet's [SW, NE] form right here.
      const b = this.radioLog.bounds
      this.lMap.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]))
    }

    this.log.excessive("out of ngOnInit()", this.id)
  }

  /**
   * Called once all HTML elements have been created.
   *
   * Leaflet measures its container when the map is constructed, and ngOnInit runs
   * before the view is laid out. On a full page load that happened to work; on a
   * client-side navigation to /mapLeaflet the container was still 0x0, so Leaflet loaded
   * no tiles and the page looked blank until a manual refresh. invalidateSize()
   * re-measures. The extra tick lets the browser finish layout first - calling it
   * synchronously here still measures 0 in some browsers.
   */
  // Cleared in ngOnDestroy - see there for why this became necessary once that method
  // actually removes the maps instead of leaving them dangling.
  private afterViewInitTimer?: ReturnType<typeof setTimeout>

  // Offline-area sizing: kept for teardown (.off()) in ngOnDestroy, since these listeners
  // are registered directly on the layer/map objects, not through Angular's own bindings.
  // F29-6 (2026-08-29): "Save this area" used to be permanently bound to OSM only - now
  // tracks EVERY tileLayerOffline base layer (OSM and OpenTopoMap) so both get saveend/
  // tilesremoved listeners and both get torn down here, not just whichever was active last.
  private offlineTileLayers: ReturnType<typeof tileLayerOffline>[] = []
  private refreshSavedAreaInfo?: () => void
  private refreshEstimatedAreaInfo?: () => void
  private refreshSavedTilesOverlay?: () => void
  private rebindOfflineAreaInfo?: (newTiles: ReturnType<typeof tileLayerOffline>) => void

  // P1-2/P1-3/P1-4 (offline map coverage scoping, 2026-09-14): the human-readable "(~N
  // tiles, ~M MB)" text refreshEstimatedAreaInfo() keeps current, reused by the confirm()
  // dialog below rather than recomputed there (the button's own visible text and the
  // confirm dialog's text should never be able to say two different things). Whether OSM is
  // the currently active base layer - the confirm() callback checks this too, as defense in
  // depth against the CSS-only disable in case a keyboard Enter ever reaches a
  // pointer-events:none control.
  private saveEstimateText = ''
  private osmBaseActive = false

  ngAfterViewInit() {
    this.afterViewInitTimer = setTimeout(() => {
      this.lMap?.invalidateSize()
      this.overviewMapLeaflet?.invalidateSize()
    })
  }

  onInstallBtn() {
    this.log.error("onInstallBtn onInstallBtn onInstallBtn onInstallBtn UNIMPLEMENTED!!!!!!!!!!!!!!!!!!!!!!", this.id)
  }

  override initMainMap() {
    //this.log.excessive("initMainMap()  pre-super", this.id)
    super.initMainMap()
    this.log.excessive("initMainMap() post-super", this.id)


    // ! Repeat of the guards in super:
    if (this.settings === null) {
      this.log.error(`Settings still NULL! while initializing the Leaflet Map!`, this.id)
      return
    }
    this.log.excessive("initMainMap() post null check", this.id)

    if (this.settings === undefined) {
      this.log.error(`initMainMap(): Settings still UNDEFINED! while initializing the Leaflet Map!`, this.id)
      return
    }

    if (this.displayReports && !this.radioLog) { //! or displayedRadioLogEntries
      this.log.error(`initMainMap():radioLog not yet initialized while initializing the Leaflet Map!`, this.id)
      return
    }

    // MarkerClusterGroup extends FeatureGroup, retaining it's methods, e.g., clearLayers() & removeLayers()
    // https://leaflet.github.io/Leaflet.markercluster/
    // per https://stackoverflow.com/a/71574063/18004414 & https://github.com/Leaflet/Leaflet/issues/8451
    this.myMarkerCluster = new window.L.MarkerClusterGroup({ removeOutsideVisibleBounds: true })


    // ---------------- Init Main Map -----------------


    //? Per guidence on settings page: Maps do not use defLat/lng... They are auto-centered on the bounding coordinates centroid of all points entered and the map is then zoomed to show all points.

    this.zoom.set(this.settings ? this.settings.leaflet.defZoom : 15)

    // this.log.excessive("initMainMap(): 3", this.id)

    // TODO: Allow centering map on user's position (geolocation): https://leafletjs.com/reference.html#locate-options
    // TODO: Provide fullscreen button: https://tomik23.github.io/leaflet-examples/#27.fullscreen

    // https://leafletjs.com/reference.html#map-locate
    this.lMap = L.map(this.mapContainer.nativeElement, {
      center: [this.settings ? this.settings.defLat : 0, this.settings ? this.settings.defLng : 0],
      zoom: this.settings ? this.settings.leaflet.defZoom : 15,
      // https://github.com/Leaflet/Leaflet.fullscreen
      // https://github.com/Runette/Leaflet.fullscreen
      // https://brunob.github.io/leaflet.fullscreen/
      // ! fullscreenControl: true
    }) // Default view set at map creation

    if (!this.lMap) {
      this.log.error(`initMainMap(): this.lMap not created!`, this.id)
      return
    }

    // https://stackoverflow.com/questions/14106687/how-do-i-change-the-default-cursor-in-leaflet-maps
    L.DomUtil.addClass(this.lMap.getContainer(), 'crosshair-cursor-enabled')  //  Enable crosshairs
    // L.DomUtil.removeClass(map._container,'crosshair-cursor-enabled') // Disable crosshairs

    // gmap: draggableCursor: 'crosshair', //https://www.w3.org/TR/CSS21/ui.html#propdef-cursor has others...
    //L.marker([50.505, 30.57], { icon: this.mapCursor }).addTo(this.lMap)

    // map can be either Leaflet or Google Map (in the abstract class) -
    // But we know it is JUST Leaflet map in this file!
    // Doing this avoids lots of type guards/hassles.
    this.map = this.lMap

    // tileLayerOffline (not plain L.tileLayer) caches tiles in IndexedDB as they're
    // viewed, and the savetiles control below lets a user explicitly save the visible
    // area for offline use - giving this engine a real offline story to compare against
    // the PMTiles map, rather than the previously-unused `leaflet.offline` import.
    const tiles = tileLayerOffline('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21,  // REVIEW: put into settings?
      minZoom: 3,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    })

    // TODO!
    //! REVIEW: Causes LOTS of "mapLeaflet:1 Uncaught (in promise) {message: 'A listener indicated an asynchronous response by r…age channel closed before a response was received'}" May need to wait, or ?????
    // Raised live 2026-08-30: default base layer is OpenTopoMap (contours), not OSM - see
    // openTopoTiles.addTo() below, which replaces this call. `tiles` (OSM) is still built
    // and offered in the layer switcher, just no longer the one shown on first load.

    // E-85 phase 2: OpenTopoMap - free, no API key, same {s}/{z}/{x}/{y} scheme as the OSM
    // layer above, so it's the same tileLayerOffline treatment (auto-caches viewed tiles
    // to IndexedDB). Contour lines are baked directly into the raster tiles. maxZoom 17 is
    // OpenTopoMap's own published tile-generation limit, not an arbitrary choice - asking
    // past it returns blank tiles. NOT added to the map here (no .addTo()): it only
    // becomes active if the user picks it from the layers control below, OSM stays the
    // default on load. NOT yet wired to the "save this area offline" control (see the
    // comment on baseLayers below) - viewing still auto-caches via tileLayerOffline, only
    // the explicit bulk-download button doesn't follow it yet.
    const openTopoTiles = tileLayerOffline('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      minZoom: 3,
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    })
    // Raised live 2026-08-30: contours are now the default view a scribe sees on first
    // load, not an option they have to discover in the layer switcher.
    openTopoTiles.addTo(this.lMap)

    // Terrain/hillshade overlay, raised in the same backlog row as this control: "also
    // wants a real layer-visibility toggle... once this or any other overlay exists." Esri's
    // World_Hillshade REST tile service (free, no API key - one of the sources this project
    // already surveyed for E-85's phase 2, never wired in until now). A plain L.tileLayer,
    // not tileLayerOffline: it's advisory relief shading laid over a base map, not a
    // navigation base layer itself, so it's deliberately outside the "save this area
    // offline"/auto-cache-on-view story the two base layers above get. 50% opacity so the
    // base layer's own roads/labels/contours stay legible underneath the shading.
    //
    // Fixed 2026-08-26 (live report): the layer had NO effect at all - toggling the
    // checkbox correctly added/removed it (confirmed reading L.Control.Layers, standard
    // Leaflet behavior), but every tile request 404'd, so there was nothing to see either
    // way. What looked like "hillshade never turns off" was OpenTopoMap's own baked-in
    // relief shading (it's a full contour basemap, not a plain one) being mistaken for this
    // overlay; "never turns on" over OSM was this broken layer genuinely rendering nothing.
    // Root cause: this service lives under an `Elevation/` folder on Esri's server
    // (`.../rest/services/Elevation/World_Hillshade/MapServer/...`), confirmed by querying
    // `?f=json` on both the guessed URL (404 "Service not found") and the corrected one
    // (200, real metadata) - a plain `World_Hillshade` at the root, as originally guessed
    // from the service's own display name, does not exist. A tile fetch at the corrected
    // URL returns a real JPEG, confirmed with curl before touching this file.
    const hillshadeOverlay = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16, minZoom: 3, opacity: 0.5,
        attribution: 'Hillshade: &copy; <a href="https://www.esri.com">Esri</a>',
      }
    )
    // Raised live 2026-08-30: on by default alongside the new contour default above - a
    // scribe still turns it off from the layer switcher same as any other overlay.
    hillshadeOverlay.addTo(this.lMap)

    // E-85 phase 1/2: the base-layer switcher (Leaflet's own standard `L.control.layers`
    // widget). USGS/Esri sources surveyed in the roadmap's E-85 row are still not wired in
    // as BASE layers - adding one later is exactly this: another key here, nothing
    // structural to change. NOT yet handled for a second layer: `wireOfflineAreaInfo()`/the
    // savetiles control below are still bound to `tiles` (OSM) specifically -
    // offline-BULK-saving OpenTopoMap needs its own wiring (or a rebind on the control's
    // `baselayerchange` event), left for whichever session actually needs it.
    const baseLayers: Record<string, L.Layer> = {
      'OpenStreetMap': tiles,
      'OpenTopoMap (contours)': openTopoTiles,
    }
    // Region download manager, phase A (scoped 2026-08-25, built 2026-08-26 on request):
    // "a browsable/verifiable record of which specific areas are on disk," not just the
    // running saved-size total wireOfflineAreaInfo() below already shows. leaflet.offline's
    // own TileInfo record already stores real per-tile x/y/z (TileManager.ts) - and the
    // library ships its own getStoredTilesAsJson(), converting that straight into a
    // Leaflet-ready GeoJSON FeatureCollection<Polygon> (its own doc comment's exact example
    // usage). No new storage, no new schema - just reading what's already there. Bound to
    // `tiles` (OSM) specifically, same scope wireOfflineAreaInfo() has - OpenTopoMap's own
    // saved tiles aren't shown here yet, same open item that row's own comment already
    // names for the bulk-save control.
    // Plain literal color, not a --rt-* token: Leaflet's SVG renderer sets these as real
    // presentation attributes at construction time, before this element is ever in the
    // document to inherit a token from - same reasoning that ruled out a token for
    // MapLibre's own paint config just above (a different renderer, same underlying
    // problem). Matches the blue MapLibre's own report-cluster circles already use.
    const savedTilesOverlay = L.geoJSON(undefined, {
      style: { color: '#2266aa', weight: 1, fillOpacity: 0.15 },
    })

    // Second param is the OVERLAY group - Leaflet's own control renders these as checkboxes
    // (independent on/off, layered over whichever base is active) rather than the base
    // group's radio buttons, which is the "real toggle" this row asked for without any
    // custom UI needed - the control already exists from E-85.
    const overlayLayers: Record<string, L.Layer> = {
      'Hillshade (terrain relief)': hillshadeOverlay,
      'Saved offline tiles': savedTilesOverlay,
      'Mile grid': this.mileGridLayer,
    }
    L.control.layers(baseLayers, overlayLayers, { position: 'topright' }).addTo(this.lMap)

    // Off by default (not .addTo(this.lMap) above, same as Hillshade) - only drawn once a
    // scribe actually wants it, and only kept in sync with the viewport while it's checked
    // on. this.lMap.hasLayer() is the guard both handlers below share, so panning/zooming
    // with the grid off costs nothing beyond the check itself.
    this.lMap.on('moveend zoomend', () => {
      if (this.lMap.hasLayer(this.mileGridLayer)) {
        this.refreshMileGrid()
      }
    })
    this.lMap.on('overlayadd', (e: L.LayersControlEvent) => {
      if (e.layer === this.mileGridLayer) {
        this.refreshMileGrid()
      }
    })

    // Raised live, 2026-08-27, comparing against a real IMT wildfire ops map: a length/
    // scale legend, same as that map's own "0 ... 2 Miles" bar. Leaflet's own built-in
    // control - both units shown (its own default), a scribe can read whichever they
    // think in, rather than this app guessing which one that is.
    L.control.scale({ position: 'bottomleft' }).addTo(this.lMap)

    // Maintainer, 2026-08-26: zoom out to show the full saved-tiles extent when the
    // checkbox is switched ON, so a scribe checking "what's actually saved" (the whole
    // point of this overlay, per its own scoping note above) doesn't land on an empty
    // view just because their current pan/zoom doesn't happen to overlap it. Deliberately
    // one-directional - `overlayremove` (unchecking) does NOT reset the view, matching how
    // every other overlay/base-layer toggle on this control already behaves (no camera
    // movement) and not fighting whatever the scribe was already looking at. Guarded
    // against an empty overlay: `L.GeoJSON.getBounds()` throws on zero features, which is
    // the normal case for a fresh device with nothing saved yet.
    this.lMap.on('overlayadd', (e: L.LayersControlEvent) => {
      if (e.layer !== savedTilesOverlay) {
        return
      }
      if (savedTilesOverlay.getLayers().length === 0) {
        return
      }
      this.lMap.fitBounds(savedTilesOverlay.getBounds())
    })

    // Bound to openTopoTiles, not tiles (OSM) - it must start matched to whichever base
    // layer actually loads by default (see openTopoTiles.addTo() above). Switching base
    // layers later rebinds this automatically via the 'baselayerchange' listener below
    // (F29-6) - that fix only fires on an actual switch, not on this initial construction.
    // maxZoom/zoomlevels below are placeholders, immediately overwritten by
    // wireOfflineAreaInfo()'s first refreshEstimatedAreaInfo() run before any click is
    // possible - real values always come from the CURRENTLY active layer (P1-2: a
    // hard-coded 19 was wrong for OpenTopoMap, whose own tile generation stops at 17).
    const openTopoMaxZoom = openTopoTiles.options.maxZoom ?? 17
    const saveTilesControl = savetiles(openTopoTiles, {
      saveText: '💾 Save this area for offline use',
      rmText: '🗑️ Remove saved tiles',
      maxZoom: openTopoMaxZoom,
      zoomlevels: zoomLevelsForSave(this.lMap.getZoom(), openTopoMaxZoom),
      parallel: 3,
      // P1-3: refuse an oversized save outright, and otherwise ask before hammering
      // OpenTopoMap's servers with however many tiles the current view/zoom-depth needs.
      confirm: (status: SaveStatus, successCallback: Function) => this.confirmSaveTiles(status, successCallback),
    }).addTo(this.lMap)
    this.offlineTileLayers = [tiles, openTopoTiles]
    // openTopoTiles (not tiles/OSM) - it's the layer actually .addTo()'d above and the one
    // saveTilesControl is actually bound to at construction; wireOfflineAreaInfo's info panel
    // needs to start tracking the SAME layer or its zoomlevels/maxZoom (and the OSM-disabled
    // check) would be wrong until the first baselayerchange event.
    this.wireOfflineAreaInfo(openTopoTiles, tiles, saveTilesControl, savedTilesOverlay)

    // F29-6 (2026-08-29): "Save this area for offline use" used to be permanently bound to
    // OSM (`tiles`), regardless of which base layer the switcher above actually had active -
    // a scribe who picked OpenTopoMap (for contours) and pressed Save got OSM tiles cached
    // for an area they might never look at on that engine again. `ControlSaveTiles.setLayer`
    // (leaflet.offline's own public API for exactly this) rebinds the button; the info-panel
    // tracking wireOfflineAreaInfo drives needs its own rebind too, since it captured OSM's
    // URL template once at construction - see rebindOfflineAreaInfo() below.
    this.lMap.on('baselayerchange', (e: L.LayersControlEvent) => {
      const newBase = e.layer as ReturnType<typeof tileLayerOffline>
      saveTilesControl.setLayer(newBase)
      this.rebindOfflineAreaInfo?.(newBase)
    })

    // Maintainer, 2026-08-24: moved out of Leaflet's floating corner-control system (it was
    // overlaying the map tiles) into normal page flow, just below the map - a plain
    // re-parent of the control's own DOM node into the template's #offlineControlsHost.
    // The control's click handlers are already bound directly to `tiles`/`this.lMap`, not
    // to anything about its position in the DOM, so this is purely visual.
    const offlineControlsContainer = saveTilesControl.getContainer()
    if (offlineControlsContainer) {
      this.offlineControlsHost.nativeElement.appendChild(offlineControlsContainer)
    }

    // TODO: Consider allowing addition of SVG overlay (of known trails and other overlays): https://leafletjs.com/reference.html#svgoverlay
    // TODO: ...or add D3 too: https://bl.ocks.org/xEviL/4921fff1d70f5601d159, w/ GeoJson: https://bl.ocks.org/xEviL/0c4f628645c6c21c8b3a https://github.com/topojson/us-atlas
    // https://www.w3schools.com/graphics/svg_examples.asp & https://commons.wikimedia.org/wiki/SVG_examples

    // https://plnkr.co/edit/zK6Ync2o23viZxSugBoX?preview
    // let svgElement = document.createElementNS("src/assets/data/King_County_Washington_Incorporated_and_Unincorporated_areas_Burien_Highlighted.svg", "svg") as SVGElement
    /*
      let svgElement = document.createElementNS("https://www.w3.org/2000/svg", "svg") as SVGElement
      svgElement.setAttribute('xmlns', "https://www.w3.org/2000/svg");
      svgElement.setAttribute('viewBox', "0 0 200 200");
      svgElement.innerHTML = '<rect width="200" height="200"/><rect x="75" y="23" width="50" height="50" style="fill:red"/><rect x="75" y="123" width="50" height="50" style="fill:#0013ff"/>';
      svgElement.innerHTML = '<rect x="80" y="60" width="250" height="250" rx="20" fill="#F00"/> <rect x="140" y="120" width="250" height="250" rx="40" fill="#00F" fill-opacity=".7"/>';
      L.svgOverlay(svgElement, [[0, 0], [1024, 1152]]).addTo(this.lMap);

      // let svgElementBounds = [[32, -130], [13, -100]]  // as number[][]
      // L.svgOverlay(svgElement, svgElementBounds).addTo(this.lMap);
  */

    if (!this.radioLog) {
      this.log.error(`initMainMap(): this.radioLog is null/undefined!`, this.id)
    } else {
      const b = this.radioLog.bounds
      this.log.info(`initMainMap() E: ${b.east};  N: ${b.north};  W: ${b.west};  S: ${b.south};  `, this.id)
    }

    this.captureLMoveAndZoom(this.lMap)

    // Sprint G: this.zoom was previously only set once, above, at init - never on an
    // actual zoom, so the "Zoom:" display went stale as soon as the user touched the
    // map. Mirrors mini-mapLeaflet.component.ts's zoomend handler.
    this.lMap.on('zoomend', () => {
      if (this.lMap) {
        this.zoom.set(this.lMap.getZoom() ?? this.settings.leaflet.defZoom)
      }
    })

    // this.lMap.on('moveend', ($event: L.LeafletEvent) => {
    //   rectangle.setBounds(this.lMap.getBounds())
    // })


    // force tile display
    /**
     * Using CSS rules for width and height with percentage (%) values. This normally doesn't cause problems
     * unless the ngx-leaflet directive is on an element that has not had its width/height explicitly set.
     * You could try using viewport-percentage units (vh or vw) which can be read about here.
     *
     * Using ngIf or CSS rule display: none. Both of these turn your Angular component into a
     * 0 size element. After an ngIf is true or display:none is reversed, your problem may be
     * solved by having the leaflet map call invalidateSize after one of those events happen.
     *
     * If neither of these suggestions are applicable, try adding a setTimeout call that then has the leaflet map call invalidateSize.
     *
     * ALSO see https://github.com/bluehalo/ngx-leaflet/issues/104#issuecomment-394883609
     */

    // https://stackoverflow.com/questions/61461292/leaflet-map-not-updating-background-tile-correctly-until-resize-or-pan-is-made
    // Call invalidateSize once the tab containing your map becomes visible
    //$('#mapcontainer').width('0');
    //this.lMap.invalidateSize();
    //$('#mapcontainer').width('50%');
    this.lMap.invalidateSize();


  }



  // The real scale control this was scoping now lives right after the layers control
  // above, alongside the E-85 base-layer switcher it was always meant to sit next to.

  // ----------------------- Scale

  // https://leafletjs.com/reference.html#control-scale
  /*
    L.control
  .scale({
    imperial: false,
  })
  .addTo(map);
  */

  /**
   * Roadmap "Offline map area" item, parts (1) and (2): shows each saved area's actual
   * file size next to "Remove saved tiles", and an anticipated MB estimate next to "Save
   * this area for offline use" before the user commits to a download. Both numbers are
   * appended as plain text INSIDE the plugin's own buttons (rather than through an Angular
   * template - `ControlSaveTiles` renders its own DOM outside Angular's view, the same way
   * the rest of this plugin's UI already does, so there is no template-reactivity gap to
   * close - see Sprint G's own scoping rule for why that matters here).
   *
   * Raised live, 2026-08-27: these used to be their own full-width rows above/below the
   * buttons, which is also what made the buttons themselves stretch full-width (block-level
   * siblings in the same non-flex container). Appending each estimate as a `<span>` inside
   * its own button's `<a>` (found via the plugin's own stable `savetiles`/`rmtiles` classes -
   * see node_modules/leaflet.offline's `_createButton`) both integrates the text into the
   * button as asked and removes the reason the row needed to be full-width at all - see the
   * width fix on `.savetiles.leaflet-bar a` in the stylesheet.
   *
   * `tiles`' URL template is what `getStorageInfo` keys off. F29-6 (2026-08-29): this used
   * to never change after construction, permanently pinning the whole info panel to OSM -
   * `activeTiles`/`urlTemplate` are now `let`s, and `rebindOfflineAreaInfo()` (stored as a
   * component field so the `baselayerchange` handler above can reach it) reassigns them and
   * re-runs every refresh when the base layer switcher picks a different tileLayerOffline.
   *
   * P1-2/P1-4 (2026-09-14): also the single place that keeps `control.options.zoomlevels`/
   * `maxZoom` matched to whichever layer is now active, and that disables the save button
   * outright while `osmLayer` (OSM's own tile policy forbids bulk offline saving; OpenTopoMap
   * has no such restriction) is the active one - see refreshEstimatedAreaInfo() below.
   */
  /**
   * P1-3/P1-4: the `confirm` option passed to `savetiles()` in initMainMap() - leaflet.offline
   * calls this with the status it already computed from whatever `options.zoomlevels`/
   * `maxZoom` refreshEstimatedAreaInfo() last set, instead of downloading immediately.
   */
  private confirmSaveTiles(status: SaveStatus, successCallback: Function): void {
    if (this.osmBaseActive) {
      // Defense in depth - the button is already CSS-disabled (rt-savetiles-disabled) and
      // its text already explains why for this case; this only matters if a click somehow
      // still reaches here (e.g. a keyboard Enter on a focused-but-disabled control).
      alert('Switch to OpenTopoMap to save for offline use - OpenStreetMap\'s servers don\'t allow it.')
      return
    }
    if (status.lengthToBeSaved > LEAFLET_SAVE_TILE_CAP) {
      alert(
        `That area would need ${status.lengthToBeSaved.toLocaleString()} tiles - above the `
        + `${LEAFLET_SAVE_TILE_CAP.toLocaleString()}-tile limit per save. Zoom in to a `
        + `smaller area, or save it in a few smaller pieces, and try again.`
      )
      return
    }
    const estimate = this.saveEstimateText || `${status.lengthToBeSaved.toLocaleString()} tiles`
    if (confirm(`Save this area for offline use (${estimate})?`)) {
      successCallback()
    }
  }

  private wireOfflineAreaInfo(
    initialLayer: ReturnType<typeof tileLayerOffline>,
    osmLayer: ReturnType<typeof tileLayerOffline>,
    control: ReturnType<typeof savetiles>,
    savedTilesOverlay: L.GeoJSON
  ) {
    const container = control.getContainer()
    if (!container) {
      this.log.error('wireOfflineAreaInfo(): saveTilesControl has no container', this.id)
      return
    }
    const saveButton = container.querySelector('a.savetiles')
    const rmButton = container.querySelector('a.rmtiles')
    if (!saveButton || !rmButton) {
      this.log.error('wireOfflineAreaInfo(): savetiles/rmtiles buttons not found in container', this.id)
      return
    }
    let activeTiles = initialLayer
    let urlTemplate = (activeTiles as any)._url as string

    const savedInfo = this.document.createElement('span')
    savedInfo.className = 'offline-area-info offline-area-info--saved'
    rmButton.appendChild(savedInfo)

    const estimateInfo = this.document.createElement('span')
    estimateInfo.className = 'offline-area-info offline-area-info--estimate'
    saveButton.appendChild(estimateInfo)

    this.refreshSavedAreaInfo = () => {
      getStorageInfo(urlTemplate).then((stored) => {
        if (stored.length === 0) {
          savedInfo.textContent = '(no tiles saved yet)'
          return
        }
        const bytes = stored.reduce((sum, t) => sum + (t.blob?.size ?? 0), 0)
        savedInfo.textContent = `(${stored.length} tiles, ~${formatBytes(bytes)})`
      }).catch((err) => this.log.error(`refreshSavedAreaInfo(): ${err}`, this.id))
    }

    // Region download manager, phase A: redraws the "Saved offline tiles" overlay (defined
    // where it's added to the layers control, above) from the current storage contents.
    // Cheap enough to run on every save/remove regardless of whether the overlay is
    // currently checked on - same call-on-every-change approach refreshSavedAreaInfo just
    // above already takes for its own text, not gated behind visibility.
    this.refreshSavedTilesOverlay = () => {
      getStorageInfo(urlTemplate).then((stored) => {
        savedTilesOverlay.clearLayers()
        if (stored.length > 0) {
          savedTilesOverlay.addData(getStoredTilesAsJson(activeTiles.getTileSize(), stored))
        }
      }).catch((err) => this.log.error(`refreshSavedTilesOverlay(): ${err}`, this.id))
    }

    this.rebindOfflineAreaInfo = (newTiles: ReturnType<typeof tileLayerOffline>) => {
      activeTiles = newTiles
      urlTemplate = (newTiles as any)._url as string
      this.refreshSavedAreaInfo?.()
      this.refreshEstimatedAreaInfo?.()
      this.refreshSavedTilesOverlay?.()
    }

    this.refreshEstimatedAreaInfo = () => {
      // P1-4: OSM's tile usage policy explicitly forbids bulk/offline downloading
      // ("Download city/country for offline use" and "Save area for later" are its own
      // named examples of what's prohibited) - OpenTopoMap's policy has no such rule (just
      // "don't overly burden the server", which the tile cap in confirmSaveTiles() below
      // covers). Disabling here, not just at click time, means a scribe never gets as far as
      // pressing a button that was always going to refuse.
      this.osmBaseActive = activeTiles === osmLayer
      saveButton.classList.toggle('rt-savetiles-disabled', this.osmBaseActive)
      saveButton.setAttribute('aria-disabled', String(this.osmBaseActive))
      if (this.osmBaseActive) {
        estimateInfo.textContent =
          '(switch to OpenTopoMap to save for offline use - OpenStreetMap\'s servers don\'t allow it)'
        this.saveEstimateText = ''
        return
      }

      // P1-2: the active layer's own maxZoom (OpenTopoMap 17, OSM 19) - a hard-coded 19 used
      // to ask OpenTopoMap for levels past its own tile-generation limit and get nothing.
      const layerMaxZoom = activeTiles.options.maxZoom ?? this.lMap.getZoom()
      const zoom = this.lMap.getZoom()
      const zoomLevels = zoomLevelsForSave(zoom, layerMaxZoom)
      control.options.zoomlevels = zoomLevels
      control.options.maxZoom = layerMaxZoom

      // Mirrors ControlSaveTiles' own _calculateTiles() for the SAME options now set above
      // (not a private API, just not exported, so replicated here from its public building
      // blocks) - summed across every level Save will actually fetch, not just the current
      // one, so the number on the button matches what pressing it really does (P1-2).
      const bounds = this.lMap.getBounds()
      const tileCount = zoomLevels.reduce((sum, levelZoom) => {
        const area = L.bounds(
          this.lMap.project(bounds.getNorthWest(), levelZoom),
          this.lMap.project(bounds.getSouthEast(), levelZoom)
        )
        return sum + getTilePoints(area, activeTiles.getTileSize()).length
      }, 0)

      getStorageInfo(urlTemplate).then((stored) => {
        const avgBytes = stored.length > 0
          ? stored.reduce((sum, t) => sum + (t.blob?.size ?? 0), 0) / stored.length
          : FALLBACK_TILE_BYTES
        this.saveEstimateText = `~${tileCount} tiles (zoom ${zoomLevels[0]}–${zoomLevels[zoomLevels.length - 1]}), ~${formatBytes(tileCount * avgBytes)}`
        estimateInfo.textContent = `(${this.saveEstimateText})`
      }).catch((err) => this.log.error(`refreshEstimatedAreaInfo(): ${err}`, this.id))
    }

    // F29-6: every offline base layer gets these, not just the one passed in above - a save/
    // remove on WHICHEVER layer is currently active should refresh the panel, and since
    // refreshSavedAreaInfo()/refreshSavedTilesOverlay() above always read the current
    // activeTiles/urlTemplate (not whatever layer originally fired the event), this stays
    // correct even for a listener left on a layer that isn't the active one anymore.
    for (const layer of this.offlineTileLayers) {
      layer.on('saveend', this.refreshSavedAreaInfo)
      layer.on('tilesremoved', this.refreshSavedAreaInfo)
      layer.on('saveend', this.refreshSavedTilesOverlay)
      layer.on('tilesremoved', this.refreshSavedTilesOverlay)
    }
    this.lMap.on('moveend zoomend', this.refreshEstimatedAreaInfo)

    this.refreshSavedAreaInfo()
    this.refreshEstimatedAreaInfo()
    this.refreshSavedTilesOverlay()
  }

  /**
   *   ---------------- Init OverView Map -----------------
   *  or consider https://tomik23.github.io/leaflet-examples/#30.mini-map
   */
  initOverviewMap() {
    //! No super.initOverviewMap(), correct?!

    // TODO: Add a light grey rectangle on overview map to show extend/bounods of main map
    this.log.info(`initOverviewMap()`, this.id)


    // instantiate the overview map without controls
    // https://leafletjs.com/reference.html#map-example
    this.overviewMapLeaflet = L.map(this.overviewContainer.nativeElement, {
      center: [this.settings.defLat, this.settings.defLng],
      zoom: this.settings.leaflet.defZoom,
      zoomControl: false,
      keyboard: false,
      scrollWheelZoom: false,
      dragging: false,
    })

    this.overviewMap = this.overviewMapLeaflet

    const overviewTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: this.settings.leaflet.overviewMaxZoom,
      minZoom: this.settings.leaflet.overviewMinZoom,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    })

    overviewTiles.addTo(this.overviewMapLeaflet)

    L.DomUtil.addClass(this.overviewMapLeaflet.getContainer(), 'crosshair-cursor-enabled')  //  Enable crosshairs

    // if (this.overviewMapLeaflet === null || this.overviewMapLeaflet === undefined) {
    //   this.log.error(`Could not create overview map!`, this.id)
    //   return
    // }
    // if (this.lMap == null || this.lMap == undefined) {
    //   this.log.error(`map doesn't exist when creating overview map!`, this.id)
    //   return
    // }

    // TODO: Switch map type on click on the overview map
    /* this.overviewMapLeaflet.addListener("click", () => {
      let mapId = this.overviewMapType.cur++ % 4
      this.overviewMapLeaflet.setMapTypeId(this.overviewMapType.types.type[mapId])
      this.log.verbose(`Overview map set to ${this.overviewMapType.types.type[mapId]}`, this.id)
    })*/

    // const infowindow = new google.maps.InfoWindow({
    //   content: "Mouse location...",
    //   position: { lat: this.settings.defLat, lng: this.settings.defLng },
    // })
    //infowindow.open(this.overviewMapLeaflet);

    this.captureLMoveAndZoom(this.overviewMapLeaflet)

    // this.overviewMapLeaflet.on("bounds_changed", () => {
    //   this.overviewMapLeaflet!.setView(this.lMap.getCenter(), this.clamp(
    //     this.lMap!.getZoom()! - (this.settings.leaflet.overviewDifference),
    //     (this.settings.leaflet.overviewMaxZoom),
    //     (this.settings.leaflet.overviewMinZoom)
    //   ))
    // })
  }

  /**
   *
   * @param ev
   */
  onMapReady(ev: any) {
    this.log.verbose(`OnMapReady()`, this.id)

    // following from https://github.com/bluehalo/ngx-leaflet/issues/104
    setTimeout(() => {
      this.lMap.invalidateSize()
    }, 0)
  }

  onMapReady2(map: L.Map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }

  /**
   * Store Lat/Lng in Clipboard (if enabled in html...)
   * @param ev
   */
  override onMouseClick(ev: MouseEvent) {
    if (!this.lMap) {
      this.log.error(`Leaflet map not created, so can't get lat & lng`, this.id)
      return
    }

    let latlng = this.lMap.mouseEventToLatLng(ev)

    // ADR D-49: armed by the "Add Location" button. Takes over this one click instead of the
    // usual copy-to-clipboard, then disarms - see placingLocation's own comment for why this
    // is one-shot rather than a persistent mode.
    if (this.placingLocation()) {
      this.placingLocation.set(false)
      this.openLocationDialog(undefined, { lat: latlng.lat, lng: latlng.lng })
      return
    }

    let coords = `${Math.round(latlng.lat * 10000) / 10000}, ${Math.round(latlng.lng * 10000) / 10000}`
    navigator.clipboard.writeText(coords)
      .then(() => {
        let status = document.getElementById('Lmap-status')
        if (status) {
          status.innerText = `${coords} copied to clipboard`
          //status.style.visibility = "visible"
          Utility.resetMaterialFadeAnimation(status)
        } else {
          this.log.info(`onMouseClick(): Entry__Minimap-status not found!`, this.id)
        }
        this.log.excessive(`onMouseClick(): ${latlng} copied to clipboard`, this.id)
      })
      .catch(err => {
        this.log.error(`onMouseClick(): latlng NOT copied to clipboard, error: ${err}`, this.id)
      })
  }

  refreshMap() {
    this.log.info(`refreshMap()`, this.id)
    // Try map.remove(); before you try to reload the map. This removes the previous map element using Leaflet's library
    if (this.lMap) {
      this.lMap.invalidateSize() // https://github.com/Leaflet/Leaflet/issues/690
      // Redraw the markers too: this only resized the canvas, so every caller that
      // changed *which* reports should be shown (the all/selected switch, a new
      // report arriving) left the old markers on screen.
      if (this.displayReports) {
        this.displayMarkers()
      }
      //or
      // this.lMap.off()
      // this.lMap.remove() // removing ALSO destroys the div id reference, so then rebuild the map div
      // this.initMap() // ?????????? Need testing!!!!
      // or
      /*
      for (i=0;i<points.length;i++) {
        map.removeLayer(points[i]);
      }
      points=[];
      */
      // or
      /* for angular: https://stackoverflow.com/a/50386028/18004414
        $scope.$on('$locationChangeStart', function( event ) {
          if(map != undefined)
          {
            map.remove();
            map = undefined
            document.getElementById('mapLayer').innerHTML = "";
          }
      });
      Without document.getElementById('mapLayer').innerHTML = "" the map was not displayed on the next page.

      This helped me. I am using Angular 6 and changing the map depending on locations the user clicks on. I just have a method to create a new map which return the map object. When I update the map, I pass the existing map object in and do the above without the innerHTML part.
      */
      //or tiles.redraw();
    }
  }


  // ------------------------------------  Markers  ---------------------------------------

  override hideMarkers() {
    this.clearMarkers()
  }

  override clearMarkers() {
    // Every marker on this map lives in the cluster group, so emptying it is the
    // whole job. Both of these logged "UNIMPLEMENTED!" and did nothing, which is
    // why switching to "just the selected reports" could never remove anything.
    this.myMarkerCluster.clearLayers()
    // Trails share the same redraw-from-scratch lifecycle as markers (E-80) - without
    // this they'd pile up on every toggle/new-report exactly the way markers used to.
    this.myTrailsLayer.clearLayers()
  }

  override displayMarkers() {
    super.displayMarkers()


    // REVIEW: wipes out any manually dropped markers. Could save 'em, but no request for that...
    if (!this.displayedRadioLogEntries) {
      this.log.error(`displayAllMarkers did not find field reports to display`, this.id)
      return
    }

    // Redraw from scratch. Without this, toggling all/selected or receiving new
    // reports piled fresh markers on top of the old ones - and the line removed
    // just above reassigned displayedRadioLogEntries to *all* reports, so the
    // selected-only view could never be honored no matter what the switch said.
    this.clearMarkers()

    this.log.verbose(`displayMarkers: ${this.displayedRadioLogEntries.length} of 'em`, this.id)
    this.displayedRadioLogEntries.forEach(i => {
      if (i.location.lat && i.location.lng) {  // TODO: Do this in the FieldReports Service - or also the GMap; thewse only happened when location was broken???
        let title = `${i.callsign} at ${formatReportTime(i.date)} with ${i.status}`
        //this.log.excessive(`displayMarkers: ${i}: ${JSON.stringify(i)}`, this.id)

        // E-86 (narrowed): a distinct shape+color per ranger callsign, team ignored for now.
        // Raised live 2026-08-26: the status halo behind it, colored per the Mission page's
        // own configured status colors - same lookup the Entry/Reports status controls use.
        const statusColor = radioLogStatusColor(i.status, this.settings.radioLogStatuses)
        // D-42 phase 5: rangerUid (unique per ranger, set even with a blank callsign) takes
        // priority over callsign - see ranger-icon.ts's header comment for why.
        let marker = L.marker(new L.LatLng(i.location.lat, i.location.lng), {
          title: title, icon: rangerIconFor(i.rangerUid || i.callsign, statusColor)
        })
        marker.bindPopup(title)
        this.myMarkerCluster.addLayer(marker);

        // E-11 (2026-08-26): evidenceLocation was captured on Entry and shown only on its
        // own mini-map - never here, so it was effectively orphaned the moment a report was
        // submitted. Same icon Entry's mini-map draws (evidenceIconFor(), shared/mapping/
        // ranger-icon.ts) so a scribe recognizes it instantly on the mission overview too.
        if (i.evidenceLocation) {
          let evidenceTitle = `Evidence/clue from ${i.callsign} at ${formatReportTime(i.date)}`
          let evidenceMarker = L.marker(
            new L.LatLng(i.evidenceLocation.lat, i.evidenceLocation.lng),
            { title: evidenceTitle, icon: evidenceIconFor() }
          )
          evidenceMarker.bindPopup(evidenceTitle)
          this.myMarkerCluster.addLayer(evidenceMarker)
        }
      } else {
        console.warn(`displayAllMarkers: skipping report # ${i.id}; bad lat/lng: ${i}: ${JSON.stringify(i)}`)
      }
    })

    this.lMap.addLayer(this.myMarkerCluster);

    this.drawTrails()
    this.lMap.addLayer(this.myTrailsLayer)

    // to refresh markers that have changed:
    // https://github.com/Leaflet/Leaflet.markercluster#refreshing-the-clusters-icon
  }

  /**
   * ADR D-49: redraws every Location marker from scratch, same "clear and rebuild" approach
   * displayMarkers() uses for field reports - cheap at the count a mission's own location
   * list reaches, and simpler than diffing which locations changed.
   *
   * Guarded on `this.lMap`: the locations subscription (constructor) can fire before the map
   * exists (ReplaySubject(1) replays synchronously) - see that subscription's own comment.
   */
  private refreshLocationMarkers(): void {
    if (!this.lMap) {
      return
    }
    this.locationsLayer.clearLayers()

    this.locations.forEach(loc => {
      const color = locationCategoryColor(loc.type, this.settings.locationTypes)
      const marker = L.marker([loc.lat, loc.lng], { title: loc.name, icon: locationIconFor(loc.type, color) })
      // Leaflet's default bubblingMouseEvents means a marker click ALSO reaches the map's
      // own click handler (onMouseClick, bound on the container div in the template) unless
      // stopped here - without this, clicking a location would also copy its coordinates to
      // the clipboard and, worse, would fire the "place a new location" flow if placingLocation
      // happened to be armed at the same time.
      marker.on('click', (ev: L.LeafletMouseEvent) => {
        ev.originalEvent?.stopPropagation()
        this.openLocationDialog(loc)
      })
      this.locationsLayer.addLayer(marker)
    })
  }

  /** Opens the add/edit dialog. `coords` for a fresh placement; `existing` to edit/delete one already on the map. */
  private openLocationDialog(existing?: MissionLocationType, coords?: { lat: number, lng: number }): void {
    this.dialog.open(LocationDialogComponent, {
      data: {
        lat: coords?.lat ?? existing?.lat ?? this.settings.defLat,
        lng: coords?.lng ?? existing?.lng ?? this.settings.defLng,
        locationTypes: this.settings.locationTypes,
        existing,
      }
    })
  }

  /** Toggled by the "Add Location" button (template). Arms the next plain map click. */
  onToggleAddLocation(): void {
    this.placingLocation.set(!this.placingLocation())
  }

  /**
   * "Zoom to Extent" (maintainer ask, 2026-09-22): re-runnable, unlike the once-at-init
   * fitBounds() in ngOnInit() above, which always covers the WHOLE log regardless of the
   * All/selected switch and ignores evidence markers and Location pins entirely. This fits
   * whatever is actually drawn right now - same three sources displayMarkers()/
   * refreshLocationMarkers() draw from.
   */
  onBtnZoomToExtent(): void {
    const points: ExtentPoint[] = []
    // Same `i.location.lat && i.location.lng` guard displayMarkers() (above) uses before
    // drawing a marker - a falsy 0 is indistinguishable from "no coordinate" there, so this
    // stays consistent with what's actually on screen rather than being stricter.
    this.displayedRadioLogEntries.forEach(i => {
      if (i.location.lat && i.location.lng) {
        points.push(i.location)
      }
      if (i.evidenceLocation?.lat && i.evidenceLocation?.lng) {
        points.push(i.evidenceLocation)
      }
    })
    this.locations.forEach(loc => points.push(loc))

    const b = computeExtent(points)
    if (!b) {
      // Nothing to fit (empty mission, or the selected-only view filtered down to nothing) -
      // leave the camera where the operator left it rather than snapping to defLat/defLng.
      this.log.info('onBtnZoomToExtent(): nothing to fit, leaving the camera alone', this.id)
      return
    }
    // maxZoom matters: without it, two reports 10m apart would slam the map to max zoom.
    this.lMap.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]), { padding: [24, 24], maxZoom: 16 })
  }

  /**
   * Redraws the mile grid overlay (see MILE_METERS' own comment) for the current viewport.
   * Clears and rebuilds from scratch rather than diffing - cheap enough at the line counts
   * a capped, zoomed-in-enough grid actually produces (see maxLines below), and far simpler
   * than tracking which lines are still in view across an arbitrary pan/zoom.
   *
   * UTM, not lat/lng: a degree of longitude is not a fixed distance (it shrinks toward the
   * poles), so only a projected system gives lines that are actually 1 mile apart on the
   * ground. Every corner of the viewport is converted using the CENTER's own UTM zone/
   * hemisphere - correct as long as the viewport doesn't itself straddle a zone boundary,
   * which is guaranteed true at every zoom level this draws at (zone boundaries are almost
   * 4° of longitude apart; this grid never draws below zoom 12, well inside a single
   * viewport's-worth of one zone).
   */
  private refreshMileGrid(): void {
    this.mileGridLayer.clearLayers()

    const zoom = this.lMap.getZoom()
    if (zoom < 12) {
      // Below this, a 1-mile grid over the visible area would be hundreds of lines -
      // unreadable, and expensive to compute/render for no benefit. Leaflet's scale bar
      // (added above) already covers "how big is this on screen" at wider zooms.
      return
    }

    // A small pad so a line doesn't visibly pop in right at the viewport's edge on pan.
    const bounds = this.lMap.getBounds().pad(0.15)
    const center = bounds.getCenter()
    const { zone, hemisphere } = DDToUTM(center.lat, center.lng)

    const corners = [
      bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast(),
    ].map(c => DDToUTM(c.lat, c.lng))
    const minE = Math.min(...corners.map(c => c.easting))
    const maxE = Math.max(...corners.map(c => c.easting))
    const minN = Math.min(...corners.map(c => c.northing))
    const maxN = Math.max(...corners.map(c => c.northing))

    // Guards against a pathological viewport (e.g. right at a UTM zone edge, where the
    // corners' eastings can disagree wildly) producing an absurd number of lines.
    const maxLines = 60
    const eastLines = Math.floor((maxE - minE) / MILE_METERS) + 1
    const northLines = Math.floor((maxN - minN) / MILE_METERS) + 1
    if (eastLines > maxLines || northLines > maxLines) {
      return
    }

    // Each line is sampled at several points and drawn as a polyline, not a single
    // two-point segment: a constant-easting or constant-northing line in UTM is not
    // perfectly straight in lat/lng (meridian convergence), so a straight two-point chord
    // would visibly drift from the true grid line over a mile-plus span at typical
    // operational zoom levels.
    const STEPS = 6
    const gridStyle: L.PolylineOptions = { color: '#3355ff', weight: 1, opacity: 0.55, interactive: false }

    const startE = Math.ceil(minE / MILE_METERS) * MILE_METERS
    for (let e = startE; e <= maxE; e += MILE_METERS) {
      const pts: L.LatLngExpression[] = []
      for (let i = 0; i <= STEPS; i++) {
        const n = minN + (maxN - minN) * i / STEPS
        const dd = UTMToDD(zone, hemisphere, e, n)
        if (dd) pts.push([dd.lat, dd.lng])
      }
      if (pts.length > 1) {
        this.mileGridLayer.addLayer(L.polyline(pts, gridStyle))
      }
    }

    const startN = Math.ceil(minN / MILE_METERS) * MILE_METERS
    for (let n = startN; n <= maxN; n += MILE_METERS) {
      const pts: L.LatLngExpression[] = []
      for (let i = 0; i <= STEPS; i++) {
        const e = minE + (maxE - minE) * i / STEPS
        const dd = UTMToDD(zone, hemisphere, e, n)
        if (dd) pts.push([dd.lat, dd.lng])
      }
      if (pts.length > 1) {
        this.mileGridLayer.addLayer(L.polyline(pts, gridStyle))
      }
    }
  }

  /**
   * E-80 phase 1: static per-callsign route trails, colored by the callsign's current
   * team. Drawn from the same displayedRadioLogEntries markers use, so the all/selected
   * switch and new-report redraws are honored automatically (both call displayMarkers(),
   * which calls this after clearMarkers() has emptied myTrailsLayer).
   *
   * Deliberately still no animation or timer - only the elapsed-time READOUT itself was
   * added back (2026-08-24 follow-on), as a value computed once when this method runs, not
   * a live-updating clock: it goes stale until the next redraw (page load, navigating to
   * /map, or either of this method's own existing redraw triggers - a new report arriving,
   * toggling all/selected), same as everything else this method draws. That distinction is
   * what makes it different from the setInterval-driven readout the original 2026-08-24
   * scoping excluded. Direction is conveyed without a clock: each trail is drawn as N-1
   * separate segments with stepped opacity (oldest faintest, newest strongest) rather than
   * a gradient-along-path, which Leaflet has no native support for.
   */
  private drawTrails() {
    // D-42 phase 5: was grouped by `r.callsign` alone. Two DIFFERENT rangers with no
    // callsign both grouped under the same '' key, so their check-ins could be sorted
    // together into one bogus trail segment connecting two unrelated people. `rangerUid`
    // (the surrogate key, unique per ranger, set even with a blank callsign) takes priority;
    // `callsign` remains the fallback for reports with no `rangerUid` - same key each marker
    // uses (see displayMarkers(), above), so a ranger's trail and marker group identically.
    const byRanger = new Map<string, RadioLogEntryType[]>()
    this.displayedRadioLogEntries.forEach(r => {
      if (!r.location.lat || !r.location.lng) return // same guard displayMarkers() uses
      const key = r.rangerUid || r.callsign
      const group = byRanger.get(key)
      if (group) group.push(r)
      else byRanger.set(key, [r])
    })

    // E-118 (2026-09-22): the staleness badge used to live INSIDE the `< 2` guard below,
    // so a ranger with exactly one check-in - the one most worth flagging, having reported
    // once and then gone silent - got no badge at all. The badge is now drawn for every
    // ranger, and only the polyline still needs two or more points.
    const intervalMin = this.settings?.checkInIntervalMin ?? DEFAULT_CHECK_IN_INTERVAL_MIN

    byRanger.forEach((reports, key) => {
      // Reports aren't guaranteed sorted - the trail is meaningless (and will look
      // plausible while being wrong) if drawn in array order instead of report date.
      const ordered = [...reports].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      // E-97: was teamColorFor(ranger.team) - team is usually blank (E-80 deferred it),
      // so nearly every trail fell through to one grey "unknown" color. rangerColorFor()
      // is the same identity-keyed function the marker fill uses, so a ranger's trail and
      // marker can never show different colors.
      const color = rangerColorFor(key)
      const segmentCount = ordered.length - 1

      for (let i = 0; i < segmentCount; i++) { // no segments at all for a lone check-in
        const opacity = segmentCount === 1 ? 0.9 : 0.25 + (0.65 * i / (segmentCount - 1))
        const segment = L.polyline(
          [
            [ordered[i].location.lat, ordered[i].location.lng],
            [ordered[i + 1].location.lat, ordered[i + 1].location.lng]
          ],
          { color, opacity, weight: 3 }
        )
        this.myTrailsLayer.addLayer(segment)
      }

      // Elapsed-time follow-on (2026-08-24): a static "minutes since" label at the
      // newest point, computed once here - see the method doc comment above for why this
      // isn't the live clock the original scoping excluded. Redone 2026-08-26: the label
      // is now the bare number (the popup already gives full detail on hover/tap).
      //
      // E-118 (2026-09-22): the band maths moved to shared/overdue.ts and is now measured
      // against the mission's own check-in interval rather than fixed 10-minute steps from
      // 20. The old inline version also disagreed with its own comment - it claimed red at
      // 90+ but the arithmetic reached the top band at 80.
      const newest = ordered[ordered.length - 1]
      const elapsedMin = elapsedMinutes(newest.date)
      const elapsedBand = overdueBand(elapsedMin, intervalMin)
      const label = L.tooltip([newest.location.lat, newest.location.lng], {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: `rt-trail-elapsed rt-trail-elapsed--${elapsedBand}`,
        opacity: 1,
      }).setContent(`${elapsedMin}`)
      this.myTrailsLayer.addLayer(label)
    })
  }

  override onSwitchSelectedRadioLog() {
    super.onSwitchSelectedRadioLog()
    this.log.excessive(`onSwitchSelectedRadioLog()`, this.id)

  }


  // displayAMarker() {
  //   this.addMarker(this.settings ? this.settings.defLat : 0 - 0.001, this.settings ? this.settings.defLng : 0 - 0.001, "Home Base")
  // }

  // override displayAllMarkers() {
  //   // this.addMarker(this.radioLog[i].lat, this.radioLog[i].lng, this.radioLog[i].status)
  // }


  // https://blog.mestwin.net/leaflet-angular-marker-clustering/
  private getDefaultIcon() {
    return L.icon({
      iconSize: [25, 41],
      iconAnchor: [13, 41],
      iconUrl: './../../assets/icons/marker-icon.png'
    })
  }

  createMarker() {
    // TODO: https://github.com/lennardv2/Leaflet.awesome-markers
    const mapIcon = this.getDefaultIcon();
    // const coordinates = latLng([this.mapPoint.latitude, this.mapPoint.longitude]);
    // this.lastLayer = marker(coordinates).setIcon(mapIcon);
    // this.markerClusterGroup.addLayer(this.lastLayer)
  }

  override addMarker(lat: number, lng: number, title: string = '') {
    this.log.excessive(`addMarker at ${lat}. ${lng}, ${title}`, this.id)

    if (!lat || !lng || !this.lMap) {
      console.error(`bad lat: ${lat} or lng: ${lng} or mapLeaflet: ${this.lMap}`)
    } else {
      let _marker = new L.Marker([lat, lng], {
        icon: iconDefault
        // ??: title
      })

      // TODO: Could add tabs on tooltips: https://tomik23.github.io/leaflet-examples/#51.tabs-in-popup
      /*
      https://javascript.plainenglish.io/how-to-create-marker-and-marker-cluster-with-leaflet-map-95e92216c391

        _marker.bindPopup(city);
        _marker.on('popupopen', function() {
          this.log.excessive('open popup', this.id);
        });
        _marker.on('popupclose', function() {
          this.log.excessive('close popup', this.id);
        });
        _marker.on('mouseout', function() {
          this.log.excessive('close popup with mouseout', this.id);
          _map.closePopup();
        });
        this.log.excessive(_map.getZoom());
        if (_map.getZoom() > 15 && _map.hasLayer(_marker)) {
          _map.closePopup();
          this.log.excessive('zoom > 15 close popup', this.id);
        }
      */

      //markerCluster.addLayer(_mar);
      //}
      //_map.addLayer(markerCluster);

      _marker.addTo(this.lMap)

      _marker.addEventListener('click', this.addManualMarkerEvent);
    }
  }

  override addManualMarkerEvent(event: any) {
    this.log.warn(`Got Marker Click!!!! event= ${JSON.stringify(event)}`, this.id)
    if (this.settings!.allowManualPinDrops) {
      if (event.latLng) {
        this.addMarker(event.latLng.lat, event.latLng.lng, `Manual Marker dropped ${event.latLng.lat}, ${event.latLng.lng} at ${Date()}`)
      } else {
        this.log.error(`addMarker FAILED`, this.id)
      }
    }
  }

  private addCircle(lat: number, lng: number, status: string = '') {
    const circle = new L.CircleMarker([lat, lng], { radius: 20 })
    if (this.lMap) {
      circle.addTo(this.lMap)
    }
  }

  /* some error on map clicking
  733786.png:1          GET https://c.tile.openstreetmap.org/21/335179/733786.png 400
  Image (async)
  createTile @ leaflet-src.js:11702
  733787.png:1          GET https://a.tile.openstreetmap.org/21/335179/733787.png 400
  */

  // TODO: https://stackoverflow.com/questions/30190268/leaflet-how-to-add-click-event-listener-to-popup
  /*
  for (var i = 0; i < users.length; i++) {
    (function (user) {
        var marker = L.marker([users[i].lat, users[i].lon], {icon: iconOff})
            .on('mouseover', function() { this.setIcon(iconOn); })
            .on('mouseout', function() { this.setIcon(iconOff); })
            .addTo(map);

        var myPopup = L.DomUtil.create('div', 'infoWindow');
        myPopup.innerHTML = "<div id='info'><p id='title'>" + users[i].title + "</p><p>" + users[i].addr + "</p></div>";

            marker.bindPopup(myPopup);

        $('#info', myPopup).on('click', function() {
            $("#userTitle").html(users[i].title).html();
            $("#userAddr").html(users[i].addr).html();
            $("#userDesc").html(users[i].desc).html();

            $("#userDetails").modal("show");
        });
    })(users[i]);
}
*/


  /**
   * from https://tomik23.github.io/leaflet-examples/#49.location-button
   */
  AddLocationButton() {
    /*
    // create custom button
  const customControl = L.Control.extend({
    // button position
    options: {
      position: "topleft",
      className: "locate-button leaflet-bar",
      html: '<svg viewBox="0 0 24 24" xmlns="https://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>',
      style:
        "margin-top: 0; left: 0; display: flex; cursor: pointer; justify-content: center; font-size: 2rem;",
    },

    // method
    onAdd: function (map) {
      this._map = map;
      const button = L.DomUtil.create("div");
      L.DomEvent.disableClickPropagation(button);

      button.title = "locate";
      button.innerHTML = this.options.html;
      button.className = this.options.className;
      button.setAttribute("style", this.options.style);

      L.DomEvent.on(button, "click", this._clicked, this);

      return button;
    },
    _clicked: function (e) {
      L.DomEvent.stopPropagation(e);

      // this.removeLocate();

      this._checkLocate();

      return;
    },
    _checkLocate: function () {
      return this._locateMap();
    },

    _locateMap: function () {
      const locateActive = document.querySelector(".locate-button");
      const locate = locateActive.classList.contains("locate-active");
      // add/remove class from locate button
      locateActive.classList[locate ? "remove" : "add"]("locate-active");

      // remove class from button
      // and stop watching location
      if (locate) {
        this.removeLocate();
        this._map.stopLocate();
        return;
      }

      // location on found
      this._map.on("locationfound", this.onLocationFound, this);
      // locataion on error
      this._map.on("locationerror", this.onLocationError, this);

      // start locate
      this._map.locate({ setView: true, enableHighAccuracy: true });
    },
    onLocationFound: function (e) {
      // add circle
      this.addCircle(e).addTo(this.featureGroup()).addTo(map);

      // add marker
      this.addMarker(e).addTo(this.featureGroup()).addTo(map);

      // add legend
    },
    // on location error
    onLocationError: function (e) {
      this.addLegend("Location access denied.");
    },
    // feature group
    featureGroup: function () {
      return new L.FeatureGroup();
    },
    // add legend
    addLegend: function (text) {
      const checkIfDescriotnExist = document.querySelector(".description");

      if (checkIfDescriotnExist) {
        checkIfDescriotnExist.textContent = text;
        return;
      }

      const legend = L.control({ position: "bottomleft" });

      legend.onAdd = function () {
        let div = L.DomUtil.create("div", "description");
        L.DomEvent.disableClickPropagation(div);
        const textInfo = text;
        div.insertAdjacentHTML("beforeend", textInfo);
        return div;
      };
      legend.addTo(this._map);
    },
    addCircle: function ({ accuracy, latitude, longitude }) {
      return L.circle([latitude, longitude], accuracy / 2, {
        className: "circle-test",
        weight: 2,
        stroke: false,
        fillColor: "#136aec",
        fillOpacity: 0.15,
      });
    },
    addMarker: function ({ latitude, longitude }) {
      return L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: "located-animation",
          iconSize: L.point(17, 17),
          popupAnchor: [0, -15],
        }),
      }).bindPopup("Your are here :)");
    },
    removeLocate: function () {
      this._map.eachLayer(function (layer) {
        if (layer instanceof L.Marker) {
          const { icon } = layer.options;
          if (icon?.options.className === "located-animation") {
            map.removeLayer(layer);
          }
        }
        if (layer instanceof L.Circle) {
          if (layer.options.className === "circle-test") {
            map.removeLayer(layer);
          }
        }
      });
    },
  });

  // adding new button to map controll
  map.addControl(new customControl());
  */
  }

  /**
   * E-64/E-70 blocker: this class declared `implements OnDestroy` but never defined one,
   * so it inherited AbstractMap.ngOnDestroy() (unsubscribes only) and never called
   * `.remove()` on either Leaflet instance. Invisible on a route change - the DOM node
   * goes away and nobody notices the map, its tile layer, its markercluster group, its
   * zoomend/moveend listeners, and leaflet.offline's handles are all still alive and
   * detached. E-64's engine switch turns that latent leak into a real one: a user
   * repeatedly flipping the "try the other map" toggle constructs a fresh Leaflet
   * instance on every flip back and abandons the previous one. The old "removing ALSO
   * destroys the div id reference" worry above (refreshMap()) does not apply here: with
   * @if, Angular destroys and recreates the container element along with the component,
   * so the container is fresh every time by construction.
   *
   * Also clears ngAfterViewInit's deferred invalidateSize() timer: with .remove() now
   * actually running, a component destroyed before that timer fires (confirmed live by
   * this fix's own unit test, which destroys immediately after detectChanges()) would
   * otherwise call invalidateSize() on an already-removed map and throw - previously
   * harmless only because the map was never really removed.
   */
  override ngOnDestroy(): void {
    super.ngOnDestroy()
    this.locationsSubscription?.unsubscribe()
    clearTimeout(this.afterViewInitTimer)
    if (this.refreshSavedAreaInfo) {
      for (const layer of this.offlineTileLayers) {
        layer.off('saveend', this.refreshSavedAreaInfo)
        layer.off('tilesremoved', this.refreshSavedAreaInfo)
        layer.off('saveend', this.refreshSavedTilesOverlay)
        layer.off('tilesremoved', this.refreshSavedTilesOverlay)
      }
    }
    if (this.refreshEstimatedAreaInfo) {
      this.lMap?.off('moveend zoomend', this.refreshEstimatedAreaInfo)
    }
    // removeLeafletMap(), not .remove() - see that helper for the zoom-animation timer
    // that otherwise throws up to 250ms after this component is gone.
    removeLeafletMap(this.lMap)
    removeLeafletMap(this.overviewMapLeaflet)
  }
}
