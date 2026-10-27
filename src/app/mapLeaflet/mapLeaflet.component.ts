

// also: https://github.com/onthegomap/planetiler
//import { openDB, deleteDB, wrap, unwrp } from 'idb'
// Leaflet must be *evaluated* before leaflet.markercluster: the plugin is old-style and
// reads the global `L` at module-evaluation time ("L is not defined" otherwise). This bare
// side-effect import guarantees that, and sorts ahead of the plugin alphabetically so
// import-sort cannot undo it. It used to work only by accident, via the eager
// `import L from 'leaflet'` that RadioLogService no longer has.
import 'leaflet'
import 'leaflet.markercluster'
//import { markerClusterGroup } from 'leaflet'
import * as L from 'leaflet'
import { removeLeafletMap } from '../shared/mapping/leaflet-teardown'
import { FilterChipsComponent } from '../shared/filter-chips/filter-chips.component'
import {
  MapShowChoice, flaggedStatuses, mapFilterChips, selectMapEntries
} from '../domain/map-entry-filter'
import { LeafletOverlays, RING_STEPS_MILES, formatRingMiles } from './leaflet-overlays'
import { LeafletOfflineController } from './leaflet-offline-controller'
import { LeafletPrintController } from './leaflet-print-controller'

//import pc from 'picocolors' // https://github.com/alexeyraspopov/picocolors
import { Subscription, throwError } from 'rxjs'

import { DOCUMENT, NgTemplateOutlet } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit, Component, ElementRef, Inject, Input, OnDestroy, OnInit, TemplateRef, ViewChild,
  ChangeDetectionStrategy, ChangeDetectorRef, computed, effect, inject, signal
} from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatSliderModule } from '@angular/material/slider'
import { MatDialog } from '@angular/material/dialog'
import { MatIconModule } from '@angular/material/icon'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'

import {
  AbstractMap, Utility, rangerIconFor, evidenceIconFor, radioLogStatusColor,
  locationCategoryColor, locationIconFor, resolveLocationIcon, formatReportTime, computeExtent, ExtentPoint
} from '../shared'
import {
  COORDINATE_FORMATS, CoordinateFormat, formatLatLng
} from '../domain/coordinate'
import {
  RadioLogService, RadioLogEntryType, LocationType, LogService, MissionLocationService,
  MissionLocationType, RangerService, MissionService
} from '../shared/services'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { LocationDialogComponent } from '../map/location-dialog/location-dialog.component'
import { MapEngineService } from '../map/map-engine.service'
import { liveRefs } from '../domain/attachments'
import { formatMsgNoShort } from '../domain/msg-no'
import { attachmentChipHtml, attachmentChipUid } from '../shared/attachments/attachment-chip-html'
import { AttachmentViewerService } from '../shared/attachments/attachment-viewer.service'
import { AttachmentStoreService } from '../shared/services/attachment-store.service'
import { ViewService } from '../shared/services/view.service'
import { AdvancedDirective } from '../shared/view/advanced.directive'
import { MapPrintFurnitureComponent } from '../map/map-print/map-print-furniture.component'
import { MapPrintLegendComponent } from '../map/map-print/map-print-legend.component'


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

// See MapLeafletComponent.ringStepIndex: 0 = Auto, n = RING_STEPS_MILES[n - 1].
const ringStepIndex = signal(0)

@Component({
  selector: 'rangertrak-mapLeaflet',
  standalone: true,
  imports: [NgTemplateOutlet, MatSlideToggleModule, MatButtonModule, MatButtonToggleModule, MatSliderModule, MatIconModule,
    FilterChipsComponent, MapPrintLegendComponent, MapPrintFurnitureComponent, AdvancedDirective],
  templateUrl: './mapLeaflet.component.html',
  styleUrls: [
    './mapLeaflet.component.scss'
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  // Deliberately NOT providing MissionService: it is providedIn:'root' and a second
  // instance here would diverge from everyone else's - see entry.component.ts's own
  // fixed-2026-08-19 note on the same historical mistake.
})
export class LmapComponent extends AbstractMap implements OnInit, AfterViewInit, OnDestroy {  //OnInit,



  public override id = 'Leaflet Map Component'

  // Owned and templated by MapPageComponent (the page shell) - this component only decides
  // WHERE in its own layout to render it (see the template, right before Instructions).
  // See map-page.component.html's own comment for why: state/handler live in one place,
  // placement is each engine's call.
  @Input() engineSwitchTemplate?: TemplateRef<unknown>
  // 2026-10-01, John: E-152b - the printed title block, owned by MapPageComponent (it already
  // has the mission and the print time); this component floats it on the map as a panel.
  @Input() printTitleTemplate?: TemplateRef<unknown>

  // static: true - these divs sit in the template unconditionally, so the query resolves
  // before ngOnInit, which is where the maps are built. Resolved from this component's own
  // view rather than by DOM id: Leaflet looks a string container up globally, and three map
  // components once all used id="map". See D-30.
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>
  @ViewChild('overviewContainer', { static: true }) private overviewContainer!: ElementRef<HTMLDivElement>
  @ViewChild('offlineControlsHost', { static: true }) private offlineControlsHost!: ElementRef<HTMLDivElement>
  @ViewChild('edgeTicks', { static: true }) private edgeTicks!: ElementRef<HTMLDivElement>
  @ViewChild('printFrame', { static: true }) private printFrame!: ElementRef<HTMLDivElement>
  @ViewChild('printTitle', { static: true }) private printTitle!: ElementRef<HTMLDivElement>
  @ViewChild('printLegend', { static: true, read: ElementRef }) private printLegend!: ElementRef<HTMLElement>
  private readonly cdr = inject(ChangeDetectorRef)
  /** E-187 phase B: where the Map page's Export places card learns what this map is showing. */
  private readonly engineService = inject(MapEngineService)
  private readonly attachmentStore = inject(AttachmentStoreService)
  private readonly journal = inject(MissionJournalService)
  private readonly attachmentViewer = inject(AttachmentViewerService)
  readonly view = inject(ViewService)

  private lMap!: L.Map
  private overviewMapLeaflet!: L.Map

  // TODO: Leaflet's version of following?
  overviewMapLeafletType = { cur: 2, types: { type: ['roadmap', 'terrain', 'satellite', 'hybrid',] } }

  // Removed 2026-09-22: the `mapCursor` L.icon pointed at assets/icons/my-icon.png, which
  // has never existed in this repo, and its only use was a commented-out L.marker() call.

  myMarkerCluster = new window.L.MarkerClusterGroup()
  // The trails, mile grid, USNG grid and range rings layers now live in LeafletOverlays
  // (leaflet-overlays.ts); these stay as the component's public names for them.
  get myTrailsLayer() { return this.overlays.myTrailsLayer }
  get mileGridLayer() { return this.overlays.mileGridLayer }
  get usngGridLayer() { return this.overlays.usngGridLayer }
  get rangeRingsLayer() { return this.overlays.rangeRingsLayer }
  mapOptions = ""

  // ADR D-49: Locations (Command Post, Staging Area, Ranger First Aid, ...). A plain layer
  // group, not clustered - locations are few and named, unlike field-report markers, so
  // collapsing them into a cluster bubble would hide the exact thing a scribe opened the map
  // to find. `locations` is cached from the subscription below and redrawn in full on every
  // change, same "redraw from scratch" reasoning displayMarkers() already documents for
  // radio log entries - cheap enough at the count a mission's own location list ever reaches.
  private locationsLayer = L.layerGroup()
  private locations: MissionLocationType[] = []
  private locationsSubscription!: Subscription

  // Armed by the "Add Location" button (template) - the NEXT plain map click places a
  // location there instead of copying coordinates (onMouseClick, below), then disarms
  // itself. One-shot, same "click, done" shape as the mini-map's Alt+click-for-evidence
  // gesture, rather than a persistent mode a scribe could forget is still on.
  placingLocation = signal(false)

  // 2026-09-30, John: the readout under the map (and click-to-copy), in the same five formats
  // as Entry. Module-level, so the choice survives leaving and returning to the Map page; not
  // saved, so a reload starts on the mission's default format again (E-208).
  readonly coordFormat = this.engineService.coordFormat
  readonly coordFormats = COORDINATE_FORMATS
  setCoordFormat(format: CoordinateFormat): void { this.engineService.chooseCoordFormat(format) }
  readonly mouseCoords = computed(() =>
    formatLatLng(this.mouseLatLng().lat, this.mouseLatLng().lng, this.coordFormat()))
  // The on-screen edge ticks are written in the readout's format, so redraw them when it changes.
  private readonly ticksFollowFormat = effect(() => {
    this.coordFormat()
    if (this.lMap) {
      this.print.refreshTicks()
    }
  })

  // 2026-09-30, John: the Range ring spacing slider under the map ("more accessible & useful for
  // experimenting" than a mission setting). Stop 0 is Auto (the spacing fits the view, see
  // refreshRangeRings()); the others are fixed RING_STEPS_MILES distances, for radio-range
  // planning where a 2 mile ring should stay 2 miles at any zoom. Module-level like
  // coordFormat, so it survives leaving the Map page; not saved.
  readonly ringStepIndex = ringStepIndex
  readonly ringStepCount = RING_STEPS_MILES.length
  /** E-207: the layers box rows that are advanced, with the layers they switch. */
  private layerExtras: { label: string, layer: L.Layer }[] = []
  private layersBox: HTMLElement | null = null

  /**
   * E-207 / D-62: in Simple view the layers box shows its extras (USNG/MGRS grid, range rings, satellite,
   * hiking trails) only while one of them is on, so a layer in use can always be switched off. Rows are
   * hidden, never removed from the control, so nothing is switched on or off by the view. In Full view each
   * row carries the plum left-edge rule (styles/_patterns.scss).
   */
  private syncLayerExtras(): void {
    if (!this.layersBox || !this.lMap) return
    const on = this.layerExtras.some(e => this.lMap.hasLayer(e.layer))
    const show = this.view.isShown('map-layers-extra', { mapExtraLayersOn: on })
    const marked = this.view.isAdvanced('map-layers-extra')
    const labels = new Set(this.layerExtras.map(e => e.label))
    this.layersBox.querySelectorAll('label').forEach(row => {
      if (!labels.has((row.textContent ?? '').trim())) return
      row.style.display = show ? '' : 'none'
      row.classList.toggle('rt-advanced', marked)
    })
  }

  /** Re-applies the above when the view changes. */
  private readonly layerExtrasFollowView = effect(() => { this.view.isShown('map-layers-extra'); this.view.isAdvanced('map-layers-extra'); this.syncLayerExtras() })

  /** Whether the Range rings overlay is on (the slider only shows then). */
  readonly ringsOn = signal(false)

  // E-190: the map's filters. Instance signals, NOT module-level and not stored: every visit to
  // the page starts with everything shown (John, 2026-10-15).
  readonly locationsOn = signal(true)
  readonly entriesOn = signal(true)
  readonly pathsOn = signal(true)
  readonly showChoice = signal<MapShowChoice>('all')
  /** Mirrors AbstractMap.showingSelectedOnly (a plain field) so the chips can react to it. */
  readonly selectedOnly = signal(false)
  readonly filterChips = computed(() => mapFilterChips({
    locationsHidden: !this.locationsOn(), entriesHidden: !this.entriesOn(), pathsHidden: !this.pathsOn(),
    choice: this.showChoice(), selectedOnly: this.selectedOnly(),
  }))
  /** The printed title block's "Filtered: ..." text; empty when nothing is filtered. */
  readonly printFilterLine = computed(() => this.filterChips().map(c => c.label).join('; '))
  /** The spacing Auto last picked, for the slider's label. */
  private readonly autoRingMiles = signal<number | undefined>(undefined)
  readonly ringSpacingLabel = computed(() => {
    const i = this.ringStepIndex()
    if (i > 0) {
      return formatRingMiles(RING_STEPS_MILES[i - 1])
    }
    const auto = this.autoRingMiles()
    return auto === undefined ? 'Auto (fits the zoom)' : `Auto, now ${formatRingMiles(auto)}`
  })
  readonly ringStepShort = (i: number) => i === 0 ? 'Auto' : `${RING_STEPS_MILES[i - 1]}`

  onRingStepChange(i: number): void {
    this.ringStepIndex.set(i)
    if (!this.lMap?.hasLayer(this.rangeRingsLayer)) {
      return
    }
    this.overlays.refreshRangeRings()
    // John, 2026-09-30: "should rings be bolder during slider movement then settle back after
    // a second or two? They might be hard to read for some busy maps." A class on the map
    // container (CSS in the scss) thickens them while the slider moves; it comes off 1.5 s
    // after the last change and the rings ease back.
    const container = this.lMap.getContainer()
    container.classList.add('rt-range-rings-emphasis')
    clearTimeout(this.ringEmphasisTimer)
    this.ringEmphasisTimer = setTimeout(() => container.classList.remove('rt-range-rings-emphasis'), 1500)
  }
  private ringEmphasisTimer?: ReturnType<typeof setTimeout>

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
  // }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  override ngOnInit() {
    super.ngOnInit()
    // `/map?place=location` (Mission > Locations > Add on the map) arms the next click, same as the Add Location button.
    if (new URLSearchParams(window.location.search).get('place') === 'location') this.placingLocation.set(true)

    // #81 finding (real, open - see the roadmap list): this used to be blamed for a
    // "mapLeaflet:1 Uncaught (in promise) {message: 'A listener indicated an asynchronous
    // response by returning true, but the message channel closed before a response was
    // received'}" console error seen twice in this file. That exact wording is a well-known
    // Chrome EXTENSION message-passing warning (password managers/ad-blockers intercepting
    // runtime.sendMessage), essentially never caused by page code - worth reconfirming in a
    // clean profile with no extensions before assuming initMainMap() is the source.
    this.initMainMap()

    this.lMap.addLayer(this.locationsLayer)
    this.refreshLocationMarkers()

    if (this.hasOverviewMap) {
      this.initOverviewMap()

      // Highlight main map location via a rectangle on the overview map
      let rectangle = L.rectangle(this.lMap.getBounds(), { color: 'Blue', fillOpacity: 0.07, weight: 1 })
      rectangle.addTo(this.overviewMapLeaflet)

      // 2026-09-30, John: E-157 - "1st going to map page, the minimap is zoomed in, not out."
      // The overview is created at the mission's default zoom (initOverviewMap) and was only
      // ever pulled out to (main zoom - overviewDifference) by a main-map 'move' event. When
      // nothing moves the main map after this point - no reports to fit to, or a fit that
      // lands on the view it already has - no event fires, and the overview stays at the same
      // zoom as the main map: zoomed in. Moving the map later fixed it, which is why only
      // the first look was wrong. So the sync is now a function that also runs once right
      // now, after the initial fit below, and again once the page has settled its size
      // (ngAfterViewInit's timer), instead of waiting on an event.
      this.syncOverview = () => {
        if (!this.lMap || !this.overviewMapLeaflet) return
        this.overviewMapLeaflet.setView(this.lMap.getCenter()!,
          this.clamp(
            this.lMap.getZoom() -
            (this.settings.leaflet.overviewDifference),
            (this.settings.leaflet.overviewMinZoom),
            (this.settings.leaflet.overviewMaxZoom)
          ), { animate: false })
        rectangle.setBounds(this.lMap.getBounds())
      }
      this.lMap.on("move", this.syncOverview)
      this.syncOverview()
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
      this.syncOverview?.()  // E-157: see above - don't rely on the fit firing 'move'
    }

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

  // 2026-09-30, John: E-138 - the blue saved-area overlay used to be a layers-menu checkbox
  // ("Saved offline tiles"); it is now driven by the "Zoom to offline tiles" button under the
  // map. `savedTilesLayer` is the same L.geoJSON, just no longer in the layers control.
  // `hasOfflineTiles` mirrors whether it has any features (kept current by
  // refreshSavedTilesOverlay), `offlineTilesShown` is the button's on state.
  public hasOfflineTiles = signal(false)
  public offlineTilesShown = signal(false)

  ngAfterViewInit() {
    this.afterViewInitTimer = setTimeout(() => {
      this.lMap?.invalidateSize()
      this.overviewMapLeaflet?.invalidateSize()
      this.syncOverview?.()  // E-157: the sizes are final now; make the overview match
    })
    this.print.attach()
    this.print.refreshTicks()
    // E-187 phase D: lets the Map page's Print card print its places with a map on top.
    this.engineService.placesPrinter.set(places => this.print.preparePlacesPrint(places))
  }

  /**
   * 2026-09-30, John: E-152 - what the printed legend describes: the entries this map is
   * drawing right now (the All / Just-selected choice already applied), set by
   * displayMarkers(). A signal because that method runs from an RxJS callback, outside
   * Angular's own bindings (zoneless - see AbstractMap's note on the same point).
   */
  /** E-157: pulls the overview map out to the main map's view; set up in ngOnInit(). */
  private syncOverview?: () => void

  public legendEntries = signal<RadioLogEntryType[]>([])
  /** E-162: which optional overlays are on, for the printed legend (see MapPrintLegendComponent.overlays). */
  public legendOverlays = signal<string[]>([])


  /** The printed sheet's coordinate note: what the edge ticks are written in. */
  readonly printCoordNote = computed(() => this.coordFormat() === 'DD'
    ? 'Edge ticks: latitude / longitude, decimal degrees, WGS84'
    : 'Edge ticks: latitude / longitude, degrees and decimal minutes, WGS84')

  override initMainMap() {
    super.initMainMap()


    // ! Repeat of the guards in super:
    if (this.settings === null) {
      this.log.error(`Settings still NULL! while initializing the Leaflet Map!`, this.id)
      return
    }

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

    // tools/e2e.js (#76 - the All/selected switch): stashed for read-only e2e introspection
    // only. A wide-enough spread of reports to rule out Leaflet.markercluster merging two
    // DISTINCT markers into one bubble (checkRangerMarkersAreDistinct's own approach) gets
    // harder to guarantee the more points a check seeds and the more zoomed-out fitBounds
    // ends up - clustering fewer markers into one bubble would silently undercount real,
    // correctly-filtered markers. Reading the cluster group's own layer count
    // (myMarkerCluster.getLayers().length) is what displayMarkers() actually populated,
    // regardless of how many bubbles that renders as on screen.
    ;(this.mapContainer.nativeElement as unknown as { __rtMarkerCluster?: unknown }).__rtMarkerCluster = this.myMarkerCluster

    // https://stackoverflow.com/questions/14106687/how-do-i-change-the-default-cursor-in-leaflet-maps
    L.DomUtil.addClass(this.lMap.getContainer(), 'crosshair-cursor-enabled')  //  Enable crosshairs
    // L.DomUtil.removeClass(map._container,'crosshair-cursor-enabled') // Disable crosshairs

    // gmap: draggableCursor: 'crosshair', //https://www.w3.org/TR/CSS21/ui.html#propdef-cursor has others...
    //L.marker([50.505, 30.57], { icon: this.mapCursor }).addTo(this.lMap)

    // map can be either Leaflet or Google Map (in the abstract class) -
    // But we know it is JUST Leaflet map in this file!
    // Doing this avoids lots of type guards/hassles.
    this.map = this.lMap

    // The offline-capable layers (OSM, OpenTopoMap, USGS aerial photos and shaded relief, the
    // saved-area overlay) are built by LeafletOfflineController; nothing is added to the map yet.
    const { tiles, openTopoTiles, usgsImageryTiles, usgsReliefOverlay, savedTilesOverlay } = this.offline.createLayers()

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

    // 2026-09-30, John: E-162 - Waymarked Trails hiking overlay: signed and mapped hiking
    // routes drawn over whichever base is showing. Plain L.tileLayer, online only (like the
    // hillshade), so not saved for offline use. Free, no API key. The attribution follows
    // the wording waymarkedtrails.org asks for: map data OpenStreetMap contributors
    // (CC-BY-SA), rendering waymarkedtrails.org. Host is in the CSP img-src (src/_headers).
    // Off by default. Tiles go to zoom 18.
    const trailsOverlay = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
      maxZoom: 18, minZoom: 3, opacity: 0.85,
      attribution: 'Hiking trails: &copy; <a href="https://hiking.waymarkedtrails.org">waymarkedtrails.org</a>, '
        + 'data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
        + '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    })

    // E-85 phase 1/2: the base-layer switcher (Leaflet's own standard `L.control.layers`
    // widget). USGS/Esri sources surveyed in the roadmap's E-85 row are still not wired in
    // as BASE layers - adding one later is exactly this: another key here, nothing
    // structural to change. NOT yet handled for a second layer: `wireOfflineAreaInfo()`/the
    // savetiles control below are still bound to `tiles` (OSM) specifically -
    // offline-BULK-saving OpenTopoMap needs its own wiring (or a rebind on the control's
    // `baselayerchange` event), left for whichever session actually needs it.
    // 2026-09-30, John: E-162 - Esri World Imagery satellite base layer. A plain L.tileLayer
    // (like the hillshade), online only: it is not a tileLayerOffline, so it neither auto-caches
    // nor is offered to "Save this area" (the baselayerchange handler below disables that
    // button while it is showing). Esri's own terms of use for World Imagery must be
    // re-checked before 1.0 (roadmap E-162). server.arcgisonline.com is already in the CSP.
    // maxZoom 19 is the service's usual detail limit; past it Leaflet just enlarges tiles.
    // Attribution is the service's own copyrightText (MapServer?f=json); Esri changed Maxar to
    // Vantor in 2026. E-162 re-check, 2026-10-20.
    const satelliteTiles = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19, minZoom: 3,
        attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      }
    )
    // 2026-09-30, John: "can the map show both satellite and a road map together, layered?" -
    // Esri's transparent Reference layers (roads, then boundaries and place names) drawn over
    // whichever base is showing; meant for Satellite, harmless over the others. Same host as
    // the imagery (already in the CSP), no API key, online only, off by default. Esri's terms
    // re-check before 1.0 covers these too (roadmap E-162). Both tile URLs checked with curl.
    const esriReference = (service: string) => L.tileLayer(
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/${service}/MapServer/tile/{z}/{y}/{x}`,
      { maxZoom: 19, minZoom: 3, attribution: 'Roads and labels: &copy; <a href="https://www.esri.com">Esri</a>' })
    const roadsLabelsOverlay = L.layerGroup([
      esriReference('World_Transportation'),
      esriReference('World_Boundaries_and_Places'),
    ])

    const baseLayers: Record<string, L.Layer> = {
      'OpenStreetMap': tiles,
      'OpenTopoMap (contours)': openTopoTiles,
      'Satellite (Esri World Imagery)': satelliteTiles,
      'USGS aerial photos (US only, can be saved)': usgsImageryTiles,
    }
    // Second param is the OVERLAY group - Leaflet's own control renders these as checkboxes
    // (independent on/off, layered over whichever base is active) rather than the base
    // group's radio buttons, which is the "real toggle" this row asked for without any
    // custom UI needed - the control already exists from E-85.
    const overlayLayers: Record<string, L.Layer> = {
      'Locations': this.locationsLayer,
      'Radio log entries': this.myMarkerCluster,
      'Ranger paths': this.myTrailsLayer,
      'Hillshade (terrain relief)': hillshadeOverlay,
      'USGS shaded relief (US only, can be saved)': usgsReliefOverlay,
      'Mile grid': this.mileGridLayer,
      'USNG / MGRS grid': this.usngGridLayer,
      'Range rings (from command post)': this.rangeRingsLayer,
      'Hiking trails (Waymarked Trails)': trailsOverlay,
      'Roads and place names (for Satellite)': roadsLabelsOverlay,
    }
    const layersControl = L.control.layers(baseLayers, overlayLayers, { position: 'topright' }).addTo(this.lMap)
    // E-207 / D-62: the layers box extras that Simple view hides while none is on (see syncLayerExtras()).
    this.layerExtras = [
      ['USNG / MGRS grid', this.usngGridLayer], ['Range rings (from command post)', this.rangeRingsLayer],
      ['Satellite (Esri World Imagery)', satelliteTiles], ['Roads and place names (for Satellite)', roadsLabelsOverlay],
      ['Hiking trails (Waymarked Trails)', trailsOverlay],
    ].map(([label, layer]) => ({ label: label as string, layer: layer as L.Layer }))
    this.layersBox = layersControl.getContainer() ?? null
    this.lMap.on('overlayadd overlayremove baselayerchange', () => this.syncLayerExtras())
    this.syncLayerExtras()
    // E-190: the three data overlays start ON (their checkboxes ticked), before any entries exist
    // and before the on/off tracking below is wired, so "on" is never mistaken for "filtered".
    this.lMap.addLayer(this.locationsLayer)
    this.lMap.addLayer(this.myMarkerCluster)
    this.lMap.addLayer(this.myTrailsLayer)

    // Off by default (not .addTo(this.lMap) above, same as Hillshade) - only drawn once a
    // scribe actually wants it, and only kept in sync with the viewport while it's checked
    // on. this.lMap.hasLayer() is the guard both handlers below share, so panning/zooming
    // with the grid off costs nothing beyond the check itself.
    this.lMap.on('moveend zoomend', () => {
      this.publishViewBounds()
      this.print.refreshTicks() // 2026-10-16, John: lat/long edge ticks on screen too
      if (this.lMap.hasLayer(this.mileGridLayer)) {
        this.overlays.refreshMileGrid()
      }
      if (this.lMap.hasLayer(this.usngGridLayer)) {
        this.overlays.refreshUsngGrid()
      }
      // Range rings re-pick their spacing for the new view (see refreshRangeRings()).
      if (this.lMap.hasLayer(this.rangeRingsLayer)) {
        this.overlays.refreshRangeRings()
      }
    })
    this.publishViewBounds()
    // E-162: track which of the new overlays are on, for the printed legend.
    const legendKeys = new Map<L.Layer, string>([
      [this.usngGridLayer, 'usng'], [this.rangeRingsLayer, 'rings'], [trailsOverlay, 'hiking'],
    ])
    const syncLegendOverlays = () => this.legendOverlays.set(
      [...legendKeys].filter(([layer]) => this.lMap.hasLayer(layer)).map(([, key]) => key))
    this.lMap.on('overlayadd overlayremove', syncLegendOverlays)
    this.lMap.on('overlayadd overlayremove', () => this.ringsOn.set(this.lMap.hasLayer(this.rangeRingsLayer)))
    // E-190: the three data overlays feed the filter chips.
    this.lMap.on('overlayadd overlayremove', (e: L.LeafletEvent) => {
      this.locationsOn.set(this.lMap.hasLayer(this.locationsLayer))
      // Printing swaps the cluster for plain markers; that is not the user hiding entries. Only the
      // cluster's own events count: while printing it is off the map, so the print rings going on
      // straight after the swap used to read as "entries hidden" (blog session, 0.99.58).
      if ((e as L.LayersControlEvent).layer === this.myMarkerCluster && !this.print.swappingMarkers) this.entriesOn.set(e.type === 'overlayadd')
      this.pathsOn.set(this.lMap.hasLayer(this.myTrailsLayer))
    })
    // 2026-10-01: the save estimate includes the USGS shaded relief while it's on.
    this.lMap.on('overlayadd overlayremove', () => this.offline.refreshEstimatedAreaInfo?.())
    this.lMap.on('overlayadd', (e: L.LayersControlEvent) => {
      if (e.layer === this.mileGridLayer) {
        this.overlays.refreshMileGrid()
      }
      if (e.layer === this.usngGridLayer) {
        this.overlays.refreshUsngGrid()
      }
      if (e.layer === this.rangeRingsLayer) {
        this.overlays.refreshRangeRings()
      }
    })

    // Raised live, 2026-08-27, comparing against a real IMT wildfire ops map: a length/
    // scale legend, same as that map's own "0 ... 2 Miles" bar. Leaflet's own built-in
    // control - both units shown (its own default), a scribe can read whichever they
    // think in, rather than this app guessing which one that is.
    // 2026-09-30, John: "Longer scale at bottom?" - 200 px rather than Leaflet's 100 px default.
    L.control.scale({ position: 'bottomleft', maxWidth: 200 }).addTo(this.lMap)

    // 2026-09-30, John: E-138 - the 2026-08-26 "zoom out to the saved extent when the layers-menu
    // checkbox goes on" behaviour moved to onBtnZoomToOfflineTiles() (the "Zoom to offline
    // tiles" button), which shows the overlay, fits to it, and hides it on a second press.

    this.offline.wire(openTopoTiles, tiles, usgsImageryTiles, savedTilesOverlay)

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
   *   ---------------- Init OverView Map -----------------
   *  or consider https://tomik23.github.io/leaflet-examples/#30.mini-map
   */
  initOverviewMap() {
    //! No super.initOverviewMap(), correct?!

    // TODO: Add a light grey rectangle on overview map to show extend/bounods of main map


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
    //   return
    // }
    // if (this.lMap == null || this.lMap == undefined) {
    //   return
    // }

    // TODO: Switch map type on click on the overview map
    /* this.overviewMapLeaflet.addListener("click", () => {
      let mapId = this.overviewMapType.cur++ % 4
      this.overviewMapLeaflet.setMapTypeId(this.overviewMapType.types.type[mapId])
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

    // A tap is the only way a phone (no hover, so no mousemove) updates the readout.
    this.mouseLatLng.set({ lat: latlng.lat, lng: latlng.lng })
    let coords = formatLatLng(latlng.lat, latlng.lng, this.coordFormat())
    navigator.clipboard.writeText(coords)
      .then(() => {
        let status = document.getElementById('Lmap-status')
        if (status) {
          status.innerText = `${coords} copied to clipboard`
          //status.style.visibility = "visible"
          Utility.resetMaterialFadeAnimation(status)
        }
      })
      .catch(err => {
        this.log.error(`onMouseClick(): latlng NOT copied to clipboard, error: ${err}`, this.id)
      })
  }

  refreshMap() {
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
    this.entryMarkers.clear()
    this.badgeMarkers.clear()
  }

  /**
   * E-194: an entry's popup is its title plus, when it has live attachments, the 📎 N chip and the
   * first image's stored thumbnail (read once the popup opens). The chip opens the viewer. Built
   * when the popup opens, so no thumbnail is read for a marker nobody clicks. MapLibre (D-56,
   * second-class) gets no chip in this phase.
   */
  private entryPopup(entry: RadioLogEntryType, title: string, marker: L.Layer): HTMLElement {
    const box = document.createElement('div')
    box.append(title)
    const chip = attachmentChipHtml(entry)
    if (!chip) return box
    const holder = document.createElement('div')
    holder.innerHTML = chip
    box.append(holder)
    box.addEventListener('click', event => {
      const uid = attachmentChipUid(event)
      if (uid) void this.attachmentViewer.open(uid)
    })
    const first = liveRefs(entry).find(r => r.type.startsWith('image/'))
    if (first) {
      void this.attachmentStore.thumbUrl(first.sha256).then(url => {
        if (!url) return
        const img = document.createElement('img')
        img.src = url
        img.alt = ''
        img.style.cssText = 'display:block;max-width:160px;max-height:120px;margin-top:6px'
        img.onload = () => marker.getPopup()?.update()   // the popup was sized before the image arrived
        box.append(img)
      }).catch(() => { /* a missing thumbnail is not worth a message */ })
    }
    return box
  }

  override displayMarkers() {
    super.displayMarkers()

    // "Manually dropped markers" were never built (the setting was removed 2026-09-26); the
    // need is served by Locations (ADR D-49), in their own locationsLayer, untouched here.
    if (!this.displayedRadioLogEntries) {
      this.log.error(`displayAllMarkers did not find radio log entries to display`, this.id)
      return
    }

    // Redraw from scratch. Without this, toggling all/selected or receiving new
    // reports piled fresh markers on top of the old ones - and the line removed
    // just above reassigned displayedRadioLogEntries to *all* reports, so the
    // selected-only view could never be honored no matter what the switch said.
    this.clearMarkers()

    // E-190: the Show choice thins the entry MARKERS; trails below still use the full
    // displayedRadioLogEntries (after the selected-only switch), so a path is always the whole trail.
    // Except "Latest per ranger" (John 2026-10-27): one point each, so no paths at all.
    const shown = this.shownEntries()
    this.legendEntries.set([...shown])
    shown.forEach(i => {
      if (i.location.lat && i.location.lng) {  // TODO: Do this in the FieldReports Service - or also the GMap; thewse only happened when location was broken???
        let title = `${i.callsign} at ${formatReportTime(i.date)}${i.msgNo ? ` (${formatMsgNoShort(i.msgNo)})` : ''} with ${i.status}`

        // E-86 (narrowed): a distinct shape+color per ranger callsign, team ignored for now.
        // Raised live 2026-08-26: the status halo behind it, colored per the Mission page's
        // own configured status colors - same lookup the Entry/Reports status controls use.
        const statusColor = radioLogStatusColor(i.status, this.settings.radioLogStatuses)
        // D-42 phase 5: rangerUid (unique per ranger, set even with a blank callsign) takes
        // priority over callsign - see ranger-icon.ts's header comment for why.
        let marker = L.marker(new L.LatLng(i.location.lat, i.location.lng), {
          title: title, icon: rangerIconFor(i.rangerUid || i.callsign, statusColor)
        })
        marker.bindPopup(layer => this.entryPopup(i, title, layer))
        this.entryMarkers.set(i, marker)
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

    // E-190: a layer the scribe unticked in the layers control stays off across redraws.
    if (this.entriesOn()) this.lMap.addLayer(this.myMarkerCluster)

    this.overlays.drawTrails(this.showChoice() !== 'latest')
    if (this.pathsOn()) this.lMap.addLayer(this.myTrailsLayer)

    // to refresh markers that have changed:
    // https://github.com/Leaflet/Leaflet.markercluster#refreshing-the-clusters-icon
  }

  /**
   * ADR D-49: redraws every Location marker from scratch, same "clear and rebuild" approach
   * displayMarkers() uses for radio log entries - cheap at the count a mission's own location
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
    // E-162: the command post may have just been added, moved or removed.
    if (this.lMap.hasLayer(this.rangeRingsLayer)) {
      this.overlays.refreshRangeRings()
    }

    this.locations.forEach(loc => {
      const color = locationCategoryColor(loc.type, this.settings.locationTypes)
      const icon = resolveLocationIcon(loc.type, this.settings.locationTypes)
      const marker = L.marker([loc.lat, loc.lng], { title: loc.name, icon: locationIconFor(icon, color) })
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
    this.shownEntries().forEach(i => {
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
      this.log.verbose('onBtnZoomToExtent(): nothing to fit, leaving the camera alone', this.id)
      return
    }
    // maxZoom matters: without it, two reports 10m apart would slam the map to max zoom.
    this.lMap.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]), { padding: [24, 24], maxZoom: 16 })
  }

  /** "Zoom to offline tiles" button (template): see LeafletOfflineController.onBtnZoomToOfflineTiles(). */
  onBtnZoomToOfflineTiles(): void {
    this.offline.onBtnZoomToOfflineTiles()
  }

  /** Print map button (template): see LeafletPrintController.onBtnPrintMap(). */
  onBtnPrintMap(): Promise<void> {
    // E-222: recorded first, so the head printed in the sheet's footer includes this print.
    this.journal.record('print-map', 'Printed the map sheet.')
    return this.print.onBtnPrintMap()
  }

  /** True while Print map is loading the sharper tiles (the button says so). */
  readonly printPreparing = signal(false)

  // 2026-10-01, John: E-152b - which report marker each minutes badge belongs to (the ranger's
  // newest), so the badge can ride with it while printing; and what each badge looked like
  // before it moved. Filled by displayMarkers() / drawTrails(), emptied with the markers.
  private readonly entryMarkers = new Map<RadioLogEntryType, L.Marker>()
  private readonly badgeMarkers = new Map<L.Tooltip, L.Marker>()

  /** Trails, mile grid, USNG grid and range rings; the component owns its lifetime. */
  private readonly overlays = new LeafletOverlays({
    map: () => this.lMap,
    settings: () => this.settings,
    locations: () => this.locations,
    displayedRadioLogEntries: () => this.displayedRadioLogEntries,
    entryMarkers: this.entryMarkers,
    badgeMarkers: this.badgeMarkers,
    ringStepIndex,
    autoRingMiles: this.autoRingMiles,
  })

  /** Offline tiles: the saved-tile layers, save control, estimate and relief save; the component owns its lifetime. */
  private readonly offline = new LeafletOfflineController({
    map: () => this.lMap,
    log: () => this.log,
    id: () => this.id,
    document: () => this.document,
    offlineControlsHost: () => this.offlineControlsHost,
    hasOfflineTiles: this.hasOfflineTiles,
    offlineTilesShown: this.offlineTilesShown,
    note: (text: string) => {
      const status = this.document.getElementById('Lmap-status')
      if (status) {
        status.innerText = text
        Utility.resetMaterialFadeAnimation(status)
      }
    },
  })

  /** Printing: the print-media re-layout, edge ticks, sharp tiles, fanning and panels; the component owns its lifetime. */
  private readonly print = new LeafletPrintController({
    map: () => this.lMap,
    settings: () => this.settings,
    myMarkerCluster: () => this.myMarkerCluster,
    locationsLayer: () => this.locationsLayer,
    mapContainer: () => this.mapContainer,
    edgeTicks: () => this.edgeTicks,
    printFrame: () => this.printFrame,
    printTitle: () => this.printTitle,
    printLegend: () => this.printLegend,
    printTitleTemplate: () => this.printTitleTemplate,
    coordFormat: this.engineService.coordFormat,
    printPreparing: this.printPreparing,
    badgeMarkers: this.badgeMarkers,
    detectChanges: () => this.cdr.detectChanges(),
    offlineTileLayers: () => this.offline.offlineTileLayers,
    deeperTilesSaved: layer => this.offline.deeperTilesSaved(layer),
  }, this.overlays)

  /** E-190: the displayed entries after the Show choice (selected-only has already been applied). */
  private shownEntries(): RadioLogEntryType[] {
    return selectMapEntries(this.displayedRadioLogEntries, this.showChoice(),
      flaggedStatuses(this.settings?.radioLogStatuses ?? []))
  }

  /** The Show toggle group (template). */
  onShowChoice(choice: MapShowChoice): void {
    this.showChoice.set(choice)
    this.displayMarkers()
  }

  /** x on one chip: turns that one filter off. */
  onClearFilter(key: string): void {
    const add = (layer: L.Layer) => { if (!this.lMap.hasLayer(layer)) this.lMap.addLayer(layer) }
    switch (key) {
      case 'locations': add(this.locationsLayer); break
      case 'entries': add(this.myMarkerCluster); break
      case 'paths': add(this.myTrailsLayer); break
      case 'show': this.onShowChoice('all'); break
      case 'selected': if (this.showingSelectedOnly) this.onSwitchSelectedRadioLog(); break
    }
  }

  /** "Show everything": every filter off. */
  onClearAllFilters(): void {
    for (const key of ['locations', 'entries', 'paths', 'selected', 'show']) this.onClearFilter(key)
  }

  override onSwitchSelectedRadioLog() {
    super.onSwitchSelectedRadioLog()
    this.selectedOnly.set(this.showingSelectedOnly)

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
        });
        _marker.on('popupclose', function() {
        });
        _marker.on('mouseout', function() {
          _map.closePopup();
        });
        if (_map.getZoom() > 15 && _map.hasLayer(_marker)) {
          _map.closePopup();
        }
      */

      //markerCluster.addLayer(_mar);
      //}
      //_map.addLayer(markerCluster);

      _marker.addTo(this.lMap)
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
  /** The visible bounds, for "Only places in the current map view" (see MapEngineService.viewBounds). */
  private publishViewBounds(): void {
    if (!this.lMap) return
    const b = this.lMap.getBounds()
    this.engineService.viewBounds.set({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy()
    this.engineService.viewBounds.set(null)
    this.engineService.placesPrinter.set(null)
    this.locationsSubscription?.unsubscribe()
    clearTimeout(this.afterViewInitTimer)
    this.print.dispose()
    clearTimeout(this.ringEmphasisTimer)
    this.offline.dispose()
    // removeLeafletMap(), not .remove() - see that helper for the zoom-animation timer
    // that otherwise throws up to 250ms after this component is gone.
    removeLeafletMap(this.lMap)
    removeLeafletMap(this.overviewMapLeaflet)
  }
}
