import { GeoJSONSource, Map as MaplibreMap, MapLayerMouseEvent, MapMouseEvent, Marker, Popup } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
// P1-5 (offline map coverage scoping, 2026-09-14): validating a scribe-picked .pmtiles file
// needs the SAME 'pmtiles' package map-style.ts already imports for the bundled/custom
// sources - no new dependency, and this file is already the lazy MapLibre-only chunk (E-64/
// E-115 bundle discipline), so importing it here doesn't put it anywhere it wasn't already.
import { FileSource, PMTiles, type Header } from 'pmtiles'
import { Subscription } from 'rxjs'

import { DOCUMENT, NgTemplateOutlet } from '@angular/common'
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Inject, Input, OnDestroy, OnInit,
  TemplateRef, ViewChild, signal
} from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatDialog } from '@angular/material/dialog'
import { MatIconModule } from '@angular/material/icon'
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle'

import {
  buildPmtilesStyle, DEFAULT_PMTILES_URL, registerCustomPmtilesSource, registerPmtilesProtocol
} from '../shared/mapping/map-style'
import {
  radioLogStatusColor, locationCategoryColor, resolveCssColorForCanvas
} from '../shared/mapping/report-marker-status'
// F29-7/8 (2026-08-29), RESOLVED 2026-09-02: rangerColorFor() used to live in the same file
// as the Leaflet-typed rangerIconFor(), so importing it here pulled `leaflet` into MapLibre's
// lazy chunk regardless - accepted at the time since Leaflet is the default /map engine and
// loads first anyway. A live PageSpeed "unused JavaScript" finding on ENTRY's own initial
// bundle showed the real cost: `radio-log.component.ts` (no map at all) had the same problem,
// and Entry's own deferred mini-map competes for the same shared chunk - neither is covered
// by "Leaflet already loaded from /map." Split into ranger-marker.ts (pure, no Leaflet) so
// this import no longer pulls Leaflet in at all. See ranger-marker.ts's header comment.
import { rangerColorFor, evidenceMarkerSvg } from '../shared/mapping/ranger-marker'
// ADR D-49, same 2026-09-02 resolution: locationMarkerSvg() moved to location-marker.ts
// (pure, no Leaflet import) - previously it lived alongside the Leaflet-typed
// locationIconFor() in location-icon.ts, which pulled `leaflet` in here too.
import { locationMarkerSvg } from '../shared/mapping/location-marker'
// Imported directly, not via the '../shared' barrel - same reasoning as the other
// shared/mapping/* imports above, this file must not risk pulling Leaflet in.
import { computeExtent, ExtentPoint } from '../shared/mapping/extent'
import {
  RadioLogType, RadioLogService, RadioLogEntryType, LogService, MissionLocationService,
  MissionLocationType, MissionService, MissionType, CustomPmtilesService, OfflineBasemapService
} from '../shared/services'
// 2026-09-02: imported directly, not via the '../shared' barrel - that barrel also
// re-exports ranger-icon.ts's Leaflet-typed functions (rangerIconFor/evidenceIconFor), and
// since 'leaflet' has side effects, esbuild can't tree-shake it out of the barrel even
// though this component uses none of those exports. Same reasoning as map-style.ts's own
// exclusion from shared/mapping/index.ts, just applied to an import site instead.
import { Utility } from '../shared/utility'
import { formatReportTime } from '../shared/mapping/report-time'
import { LocationDialogComponent } from './location-dialog/location-dialog.component'

const REPORTS_SOURCE_ID = 'field-reports'

// Small local helper, deliberately not imported from mapLeaflet.component.ts's own copy -
// that file eagerly imports 'leaflet', and this component is its own separate lazy chunk
// (E-64/E-115 bundle discipline) that must never pull Leaflet in just to format a byte count.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * MapLibre + PMTiles full-page map. A sibling to LmapComponent (Leaflet), not a
 * replacement - both engines ship side by side until real usage shows which is better.
 * See PRIVATE-Roadmap.md "Mapping" section.
 */
@Component({
  selector: 'rangertrak-mapLibre',
  standalone: true,
  imports: [NgTemplateOutlet, MatSlideToggleModule, MatButtonModule, MatIconModule],
  templateUrl: './mapLibre.component.html',
  styleUrls: ['./mapLibre.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class MapLibreComponent implements OnInit, AfterViewInit, OnDestroy {

  // Owned and templated by MapPageComponent (the page shell), passed through
  // ngComponentOutletInputs since this component is mounted dynamically - this component
  // only decides WHERE in its own layout to render it (see the template, right before
  // Instructions). See map-page.component.html's own comment for why.
  @Input() engineSwitchTemplate?: TemplateRef<unknown>

  // Resolved from this component's own view, never by DOM id. Three map components once
  // all used id="map", and both MapLibre and Leaflet resolve a string container globally -
  // so whichever matching element the document happened to hold first won. See D-30.
  @ViewChild('mapContainer') private mapContainer!: ElementRef<HTMLDivElement>
  @ViewChild('overviewContainer') private overviewContainer!: ElementRef<HTMLDivElement>

  private map!: MaplibreMap
  private overviewMap: MaplibreMap | undefined
  private settings!: MissionType
  private radioLog: RadioLogType | undefined
  private showingSelectedOnly = false

  private missionSubscription!: Subscription
  private radioLogSubscription!: Subscription

  // Mutated from MapLibre's own event listeners / an RxJS subscribe callback, not
  // Angular template bindings - this app is zoneless, so a plain field written there
  // has no guaranteed path back into change detection. Signals close that gap. (Sprint G)
  public numAllRows = signal(0)
  public numSelectedRows = signal(0)
  public zoomDisplay = signal(15)
  // E-64: mirrors LmapComponent's readout - cheap to add since the map/mousemove idiom is
  // already used here for zoomend. Stays at its initial value on touch devices (no
  // `mousemove` event there), same as the Leaflet readout - not a regression.
  public mouseLatLng = signal({ lat: 0, lng: 0 })

  // Terrain overlay, off by default (same default as Leaflet's own equivalent checkbox
  // below) - see addHillshadeLayer()'s own comment for the source and why it's a real
  // MapLibre layer rather than a second style.
  // REVERTED live 2026-08-30, same day it was turned on: a live report (screenshots, phone,
  // zoomed both out and in to Vashon) showed hillshade rendering as a full-viewport pale
  // relief texture with NO visible basemap underneath at all - no roads, no water, no land
  // colour. This engine's bundled vashon.pmtiles is already known to have very sparse tile
  // coverage (Private Roadmap.md's own root-cause note: ~350 tiles total for the whole-island
  // bounds its header claims), a data problem, not a code one. With hillshade off, a missing
  // basemap read as an obviously-blank map; with it on, the same gap gets dressed up in a
  // relief texture that looks like it might be real terrain, which is worse - it hides the
  // fact that the basemap itself failed to render rather than surfacing it. Back to off by
  // default until the tileset itself is regenerated with real coverage.
  public hillshadeVisible = signal(false)

  // ADR D-49: Locations (Command Post, Staging Area, Ranger First Aid, ...). Plain
  // `maplibregl.Marker` DOM overlays, not a GeoJSON `symbol` layer like the field-report
  // dots above - locations are few and named, and a real DOM element is the simplest way to
  // reuse locationMarkerSvg()'s own SVG string unchanged (a `symbol` layer would need each
  // shape pre-registered as a raster/SDF image via `map.addImage()` instead).
  private locationMarkers: Marker[] = []
  private locations: MissionLocationType[] = []
  private locationsSubscription!: Subscription

  // E-11 (2026-08-26): evidenceLocation was captured on Entry and shown only on its own
  // mini-map - the main Leaflet map (mapLeaflet.component.ts) already draws it, this engine
  // did not. Same plain-Marker-array approach as the Location markers just above: an
  // evidence flag is a rare, non-clustered overlay, not a natural fit for the reports
  // GeoJSON source's circle/cluster layers.
  private evidenceMarkers: Marker[] = []

  // Armed by the "Add Location" button (template) - the next plain map click places a
  // location there instead of copying coordinates (onMapClick, below), then disarms itself.
  // Mirrors LmapComponent's own placingLocation - see its comment for why one-shot.
  public placingLocation = signal(false)

  // Safety net for the "adjacent tiles stay gray after a fast zoom-out" bug (root cause:
  // see registerPmtilesProtocol()'s own doc comment in map-style.ts) - maplibre-gl's own
  // TileManager._loadTile has no AbortError special case, so ANY rejected tile load parks
  // permanently in `state: "errored"`; `reload()` explicitly skips errored tiles, and the
  // only public lever that revives one is `map.refreshTiles(sourceId, tileIds)`. This stays
  // even with the ResolvedValueCache fix in map-style.ts, since that only closes the
  // specific poisoned-cache mechanism found this session - a genuinely dropped connection
  // mid-tile-load is still possible and would hit this same dead end without it.
  //
  // Both this component's maps (the main map and initOverviewMap()'s thumbnail) share one
  // `basemap` source id but are separate MapLibre `Map` instances with their own, separate
  // tile managers - a tile erroring on one says nothing about whether the other even has
  // it in view. Tracked and debounced per Map instance (keyed in the two Maps below, not
  // as flat component fields) so each map's errored tiles get exactly ONE retry each,
  // batched behind a short delay since a fast zoom-out errors a whole cluster of tiles in
  // the same animation frame or two and refreshTiles() takes an array. One retry per tile
  // per map instance - not per tile alone - so a tile that keeps failing (truly missing
  // from the archive, sustained offline) surfaces as a permanent gray tile again rather
  // than retrying forever; this is a bounded safety net, not a guarantee.
  private readonly retriedTileKeysByMap = new Map<MaplibreMap, Set<string>>()
  private readonly pendingTileRetriesByMap = new Map<MaplibreMap, { z: number, x: number, y: number }[]>()
  private readonly retryDebounceTimersByMap = new Map<MaplibreMap, ReturnType<typeof setTimeout>>()
  private static readonly retryDebounceMs = 300

  // P1-5: the active custom file's own header bbox, read once in initMaps() - lets the
  // 'load' handler fly there if the map's initial center (the mission's own default lat/lng)
  // falls outside it, instead of silently sitting on the bundled archive's own gray
  // background the way it did before (a tester loading e.g. Manchester used to land on
  // Vashon with nothing rendered until they manually panned/zoomed away).
  private customArchiveBounds?: [minLon: number, minLat: number, maxLon: number, maxLat: number]

  constructor(
    private missionService: MissionService,
    private radioLogService: RadioLogService,
    private locationService: MissionLocationService,
    private dialog: MatDialog,
    private log: LogService,
    public customPmtiles: CustomPmtilesService,
    private offlineBasemap: OfflineBasemapService,
    @Inject(DOCUMENT) private document: Document
  ) {
    registerPmtilesProtocol()

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => { this.settings = newMission },
      error: (e) => this.log.error('MapLibreComponent mission subscription error: ' + e, 'MapLibreComponent')
    })

    // Cached here rather than only read on demand, same reasoning as LmapComponent's own
    // constructor subscription: the ReplaySubject(1) replays synchronously, before `this.map`
    // exists - refreshLocationMarkers() guards on it, and the `'load'` handler below calls it
    // again once the map is actually built.
    this.locationsSubscription = this.locationService.getLocationsObserver().subscribe({
      next: (newLocations) => {
        this.locations = newLocations
        this.refreshLocationMarkers()
      },
      error: (e) => this.log.error(`MapLibreComponent locations subscription error: ${e}`, 'MapLibreComponent')
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (newReports) => {
        this.radioLog = newReports
        this.numAllRows.set(newReports.numReport)
        this.refreshMarkers()
        this.refreshEvidenceMarkers()
      },
      error: (e) => this.log.error('MapLibreComponent field reports subscription error: ' + e, 'MapLibreComponent')
    })
  }

  ngOnInit(): void {
    this.radioLog = this.radioLogService.getCurrentRadioLog()
    this.numAllRows.set(this.radioLog.numReport)
    this.zoomDisplay.set(this.settings.maplibre.defZoom)
    this.mouseLatLng.set({ lat: this.settings.defLat, lng: this.settings.defLng })
  }

  ngAfterViewInit(): void {
    // Fire-and-forget: nothing in Angular's lifecycle needs to block on this, but
    // resolvePmtilesUrl() below needs CustomPmtilesService's IndexedDB read to have
    // finished FIRST, or a fresh page load (including the very reload this feature's own
    // "load a file" flow triggers) would build the map against the bundled default even
    // when a custom file is stored - the signal it reads just wouldn't be populated yet.
    this.initMaps()
  }

  private async initMaps(): Promise<void> {
    await this.customPmtiles.whenReady()
    await this.loadCustomArchiveBounds()

    this.map = new MaplibreMap({
      container: this.mapContainer.nativeElement,
      style: buildPmtilesStyle(this.resolvePmtilesUrl()),
      center: [this.settings.defLng, this.settings.defLat],
      zoom: this.settings.maplibre.defZoom,
      // NOT the fix for the "adjacent tiles stay gray after a fast zoom-out" bug - kept only
      // for its own real, narrower effect (see below). A live report (2026-09-01) plus a
      // DevTools Network tab showing a pile of (canceled) vashon.pmtiles fetches first looked
      // like this option's doing, but reading maplibre-gl's own source (not the minified
      // bundle's behavior guessed at) shows it only controls whether a coarser, already-
      // loaded PARENT tile is retained as a placeholder while the ideal tile is still loading
      // (TileManager._updateRetainedTiles) - it has no effect on whether the ideal tile's own
      // fetch gets aborted. Confirmed empirically after setting this false: a CDP script that
      // hooked window.fetch before the app loaded and drove a fast zoom-out against the live
      // deployed site (rangertrak.org) still showed aborted vashon.pmtiles range-fetches with
      // ZERO later re-fetch of the same byte range, even 12s after the gesture settled - so
      // tiles are genuinely, permanently abandoned, not just repainted late. Root cause still
      // open - see PRIVATE-Roadmap.md's Sept 1 session notes for the CDP diagnostic script and
      // raw fetch log. Left `false` anyway since it's a real, harmless behavior in its own
      // right (retains a blurrier placeholder tile longer instead of flashing to background
      // color while its replacement loads) - just don't credit it with fixing this bug.
      cancelPendingTileRequestsWhileZooming: false
    })

    // Without a listener MapLibre swallows source/tile failures into a console warning at
    // most, so a basemap that never loads looks identical to one that loaded empty. Log
    // them: an offline map silently showing blank is the single most confusing failure
    // this screen can have.
    this.map.on('error', (ev: any) => {
      this.log.error(`MapLibre error${ev?.sourceId ? ` (source "${ev.sourceId}")` : ''}: ${ev?.error?.message ?? JSON.stringify(ev)}`, 'MapLibreComponent')
      // `ev.tile` is only present when this error came from a tile load rejecting (see
      // this constructor's retriedTileKeysByMap comment above) - style/validation errors
      // don't carry one, and this safety net has nothing to retry for those.
      if (ev?.sourceId === 'basemap' && ev.tile?.tileID?.canonical) {
        this.scheduleTileRetry(this.map, ev.tile.tileID.canonical)
      }
    })

    this.map.on('load', () => {
      this.addHillshadeLayer()
      this.addReportsSource()
      this.refreshMarkers()
      this.refreshLocationMarkers()
      this.refreshEvidenceMarkers()
      this.fitToBounds()
      // P1-5: only takes over when fitToBounds() above left the camera where it started (no
      // reports yet to fit to) AND that starting point isn't even inside the custom
      // archive's own coverage - a scribe with existing reports inside their own loaded
      // area already gets a sensible view from fitToBounds() alone.
      this.flyToCustomArchiveIfOutsideView()
      // Not called here directly - see warmBundledPmtilesCache()'s own doc comment for why
      // firing it inside this same handler reopens exactly the race it was written to close.
      this.map.once('idle', () => this.warmBundledPmtilesCache())
    })

    this.map.on('zoomend', () => { this.zoomDisplay.set(Math.round(this.map.getZoom())) })

    // Mirrors LmapComponent's own readout. `mousemove` fires continuously - if this ever
    // causes jank, throttle it - but Leaflet's own mousemove-driven readout does the same
    // thing today with no reported issue, so this is not a new pattern. No-op on touch
    // devices (no `mousemove` there), same as the Leaflet readout - not a regression.
    this.map.on('mousemove', (ev: MapMouseEvent) => {
      this.mouseLatLng.set({ lat: ev.lngLat.lat, lng: ev.lngLat.lng })
    })

    this.map.on('click', (ev: MapMouseEvent) => this.onMapClick(ev))

    this.initOverviewMap()
  }

  private initOverviewMap(): void {
    this.overviewMap = new MaplibreMap({
      container: this.overviewContainer.nativeElement,
      style: buildPmtilesStyle(this.resolvePmtilesUrl()),
      center: [this.settings.defLng, this.settings.defLat],
      zoom: this.settings.maplibre.overviewMinZoom,
      interactive: false,
      // The main map above carries the attribution, which is what OSM's terms require of
      // the page. A second copy inside a 175px decorative thumbnail only wrapped to three
      // lines and spilled out the bottom - see 25a item 6.
      attributionControl: false,
      // Same fix as the main map's constructor above, same symptom on this instance too -
      // see that option's own comment for the root cause.
      cancelPendingTileRequestsWhileZooming: false
    })

    // Same tile-retry safety net as the main map's own 'error' listener above - a separate
    // Map instance with its own tile manager, so it needs its own listener and its own
    // per-map retry bookkeeping (see retriedTileKeysByMap's doc comment on why).
    this.overviewMap.on('error', (ev: any) => {
      if (ev?.sourceId === 'basemap' && ev.tile?.tileID?.canonical) {
        this.scheduleTileRetry(this.overviewMap!, ev.tile.tileID.canonical)
      }
    })

    // 'moveend', not 'move' - root-caused live 2026-09-01, a maintainer report that the
    // overview stayed stuck on stale, tightly-bounded content at every zoom level tested
    // (6, 5, 2, 0) while the main map correctly showed the bundled archive's real, much
    // broader low-zoom coverage. 'move' fires on every frame of a pan/zoom gesture, so a
    // continuous zoom-out was calling jumpTo() on the overview many times a second - each
    // call is itself a camera change, so MapLibre cancelled the previous call's in-flight
    // tile requests to chase the new one. A gesture faster than one tile round trip (~150-
    // 450ms, measured) meant the overview never finished a single load; it just kept
    // interrupting itself and showing whatever it rendered before the gesture began. This
    // also accounts for the volume of (canceled) vashon.pmtiles requests observed live
    // during ordinary map interaction - most of that churn was the overview racing itself.
    // 'moveend' fires once, after the camera settles, which is what this decorative,
    // non-interactive thumbnail actually needs: it does not have to track the main map
    // frame-by-frame, only end up showing the same place once panning/zooming stops.
    this.map.on('moveend', () => {
      if (!this.overviewMap) {
        return
      }
      const center = this.map.getCenter()
      const targetZoom = this.clamp(
        this.map.getZoom() - this.settings.maplibre.overviewDifference,
        this.settings.maplibre.overviewMinZoom,
        this.settings.maplibre.overviewMaxZoom
      )
      this.overviewMap.jumpTo({ center, zoom: targetZoom })
    })
  }

  private clamp(num: number, min: number, max: number): number {
    return Math.min(Math.max(num, min), max)
  }

  /** The bundled vashon.pmtiles URL, unless a scribe has loaded their own coverage - see
   *  CustomPmtilesService's own doc comment for why PMTiles (one archive per region, no
   *  per-tile store) needs this rather than Leaflet's live "save this area" control. */
  private resolvePmtilesUrl(): string {
    const custom = this.customPmtiles.activeFile()
    return custom ? registerCustomPmtilesSource(custom) : DEFAULT_PMTILES_URL
  }

  /**
   * Loads a scribe-picked `.pmtiles` file and reloads the page - same "Reloading so every
   * screen picks them up..." pattern Rangers' own roster/photo imports already use, rather
   * than trying to live-swap an already-rendered MapLibre map's tile source (its GeoJSON
   * reports source, cluster state, hillshade layer and every marker would all need
   * re-adding in the right order; starting fresh from ngAfterViewInit() is far less
   * error-prone than reproducing that sequence a second time in a live-swap path).
   *
   * P1-5 (2026-09-14): used to store whatever was picked with no validation at all - a file
   * that wasn't really a PMTiles archive stored fine and only failed later, silently, as a
   * blank map. `PMTiles.getHeader()` already validates the real spec magic number (a 2-byte
   * "PM" signature at offset 0 - `bytesToHeader()`'s own source, not the 7-byte ASCII string
   * the initial scoping guess assumed) and throws a real error for anything else, so
   * validation is "try to read the header, reject on failure" rather than a second,
   * hand-rolled check that could disagree with the library's own parser.
   */
  async onCustomPmtilesFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event

    if (!file) {
      return
    }

    let header: Header
    try {
      header = await new PMTiles(new FileSource(file)).getHeader()
    } catch (err) {
      this.log.warn(`onCustomPmtilesFileSelected(): rejected "${file.name}": ${err}`, 'MapLibreComponent')
      alert(
        `"${file.name}" doesn't look like a real PMTiles archive`
        + `${err instanceof Error ? ` (${err.message})` : ''}.\n\n`
        + `Nothing was loaded - the map still shows what it showed before.`
      )
      return
    }

    const boundsText = `${header.minLat.toFixed(2)}, ${header.minLon.toFixed(2)} to `
      + `${header.maxLat.toFixed(2)}, ${header.maxLon.toFixed(2)}`
    const storageWarning = await this.storageHeadroomWarning(file.size)

    if (!confirm(
      `Use "${file.name}" (${formatBytes(file.size)}, zoom ${header.minZoom}–${header.maxZoom}, `
      + `covers ${boundsText}) as the offline map instead of the current one?\n\n`
      + `This replaces the map on this device until you clear it.${storageWarning}\n\n`
      + `Reloading so every map view picks it up...`)) {
      return
    }

    await this.customPmtiles.setFile(file)
    window.location.reload()
  }

  /** P1-5(iii): a cheap guard `navigator.storage.estimate()` makes possible - warns rather
   *  than blocks, since the estimate is only ever approximate and a scribe with a real need
   *  should still be able to proceed. Returns an empty string (no warning) when the API is
   *  unavailable or the file comfortably fits. */
  private async storageHeadroomWarning(fileBytes: number): Promise<string> {
    if (!navigator.storage?.estimate) {
      return ''
    }
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      const remaining = quota - usage
      if (quota > 0 && fileBytes > remaining * 0.8) {
        return `\n\nWarning: this file is ${formatBytes(fileBytes)}, and this device has only `
          + `about ${formatBytes(Math.max(remaining, 0))} of storage headroom left. Loading it `
          + `may fail, or push other data out.`
      }
    } catch (err) {
      this.log.warn(`storageHeadroomWarning(): navigator.storage.estimate() failed: ${err}`, 'MapLibreComponent')
    }
    return ''
  }

  async onBtnClearCustomPmtiles(): Promise<void> {
    if (!confirm('Stop using the custom offline map and go back to the bundled Vashon extract?')) {
      return
    }
    await this.customPmtiles.clear()
    window.location.reload()
  }

  /**
   * Mission Readiness's "bundled MapLibre asset warmed" signal (mission-readiness.service.ts)
   * does a plain, read-only `caches.match(DEFAULT_PMTILES_URL)` - a deliberately separate,
   * hand-managed cache entry, not ngsw's internal one. The readiness check's `caches.match()`
   * searches every cache in this origin, so the two never needed to share one, only the URL
   * key.
   *
   * ROOT-CAUSED 2026-08-27, RE-ROOT-CAUSED 2026-08-30, ACTUALLY ROOT-CAUSED 2026-09-01 (live
   * report, this time with DevTools Network evidence): both `vashon.pmtiles` requests came
   * back `200` (not pmtiles-js's expected `206`), Size column reading `(ServiceWorker)` - the
   * request was answered by Angular's service worker, not the network. This THIRD time, that
   * was checked against ngsw-worker.js's actual source rather than assumed: its `onFetch` gate
   * (driver.ts) has no Range-header check anywhere - it bypasses only for `ngsw-bypass`, its
   * own state path, safe mode, mixed content, and invalid `only-if-cached`. There never was a
   * "documented limitation" that skips Range requests, despite what the previous two passes
   * on this comment claimed; that was a misdiagnosis this whole time. `vashon.pmtiles` was
   * simply inside `ngsw-config.json`'s `/assets/**` glob like every other bundled asset, so
   * ngsw claimed the URL, cached whatever it first got back for it, and served that same
   * response - Range header or not - to every later request. **Fixed at the source**:
   * `ngsw-config.json` now excludes `/assets/maps/**` from the "assets" group entirely, so
   * this URL reaches the network - and this app's own Worker, already verified to answer
   * Range requests correctly - like any other Range-fetched resource should.
   *
   * The two "RE-ROOT-CAUSED" theories below are superseded, not deleted, because both prior
   * passes did real, valid work narrowing down symptoms even though neither reached the
   * actual cause - the sequencing and coalescing risks they found and fixed are still real
   * risks in their own right, independent of the ngsw bug that was the actual reason the map
   * stayed blank:
   *
   * 2026-08-27: suspected browser-level request coalescing between this plain warming fetch
   * and pmtiles-js's own concurrent Range fetch at the same URL - moved this call to run only
   * after `'load'`, so it wouldn't race the map's own critical basemap fetches.
   *
   * 2026-08-30: `'load'`'s own `fitToBounds()` call (just above) turned out to kick off a
   * fresh round of Range fetches at the exact moment this function used to run, moving the
   * suspected race one step later rather than closing it - deferred further, to the map's
   * `'idle'` event, so every fetch `fitToBounds()` triggers has already resolved first.
   *
   * `cache: 'no-store'` stays as defense in depth for a *repeat* mount (navigate away from
   * `/map` and back, or flip engines twice): without it, this fetch's own response could sit
   * in the browser's ambient HTTP cache and interfere with a later instance's pmtiles-js Range
   * fetch - now a network-level, not ngsw-level, concern, but a real one either way.
   *
   * 2026-09-14 (offline map coverage scoping, Q6 YES addendum): the actual fetch-and-cache
   * work moved to `OfflineBasemapService.warm()` - the bundled archive nearly 10x'd in size
   * (Vashon-only 1.7 MB -> merged world+Vashon ~16 MB), so "one plain fetch, no retry, no
   * stall handling, re-downloads every visit" stopped being good enough. Everything on THIS
   * call site is unchanged: still fired from 'idle' for the exact race-avoidance reasons
   * above, and `userInitiated: true` because reaching this line already IS "the scribe opened
   * the alternative map" - see that service's own `warm()` doc comment for why that matters
   * (it's the documented exception to skipping automatic warming on a Data Saver connection).
   */
  private warmBundledPmtilesCache(): void {
    this.offlineBasemap.warm({ userInitiated: true })
      .catch(err => this.log.warn(`Failed to warm bundled PMTiles cache entry: ${err}`, 'MapLibreComponent'))
  }

  /**
   * Queues one errored basemap tile, on ONE specific map instance, for a single retry via
   * that map's own `refreshTiles()` - see retriedTileKeysByMap's own doc comment
   * (constructor) for why this exists and why it's tracked per-map. Debounced rather than
   * firing per-tile: a fast zoom-out errors a whole cluster of tiles inside the same
   * animation frame or two, and `refreshTiles()` takes an array, so one call per burst is
   * both cheaper and less startling than a flurry of individual reloads.
   */
  private scheduleTileRetry(map: MaplibreMap, canonical: { z: number, x: number, y: number, key: string }): void {
    let retriedKeys = this.retriedTileKeysByMap.get(map)
    if (!retriedKeys) {
      retriedKeys = new Set<string>()
      this.retriedTileKeysByMap.set(map, retriedKeys)
    }
    if (retriedKeys.has(canonical.key)) {
      return
    }
    retriedKeys.add(canonical.key)

    const pending = this.pendingTileRetriesByMap.get(map) ?? []
    pending.push({ z: canonical.z, x: canonical.x, y: canonical.y })
    this.pendingTileRetriesByMap.set(map, pending)

    clearTimeout(this.retryDebounceTimersByMap.get(map))
    this.retryDebounceTimersByMap.set(map, setTimeout(() => {
      const tileIds = this.pendingTileRetriesByMap.get(map) ?? []
      this.pendingTileRetriesByMap.set(map, [])
      if (!tileIds.length) {
        return
      }
      this.log.info(`Retrying ${tileIds.length} basemap tile(s) that failed to load.`, 'MapLibreComponent')
      map.refreshTiles('basemap', tileIds)
    }, MapLibreComponent.retryDebounceMs))
  }

  /**
   * Terrain relief overlay - raised in the same backlog row as a request for "a real
   * layer-visibility toggle... once this or any other overlay exists." Esri's
   * World_Hillshade REST tile service (free, no API key), same source used for Leaflet's
   * equivalent checkbox (mapLeaflet.component.ts) - kept as ONE real MapLibre layer added
   * on top of the vector basemap, not a second style, so toggling it is a plain
   * `setLayoutProperty` visibility flip rather than swapping the whole map's style (which
   * would flash/reload the basemap and lose the reports source). Starts hidden
   * (`visibility: 'none'`) so the default view is unchanged - briefly turned on by default
   * 2026-08-30, reverted the same day (see `hillshadeVisible`'s own comment for why);
   * `raster-opacity` matches Leaflet's own 50% so the vector roads/water/buildings stay
   * legible underneath.
   *
   * Fixed 2026-08-26 (live report, found via the Leaflet side - same URL bug here, not yet
   * separately reported for this engine): the URL was missing Esri's `Elevation/` folder
   * segment - `.../rest/services/World_Hillshade/MapServer/...` 404s ("Service not found",
   * confirmed with `?f=json`); the real service lives at
   * `.../rest/services/Elevation/World_Hillshade/MapServer/...`. See mapLeaflet.component.ts's
   * matching layer for the full diagnosis.
   */
  private addHillshadeLayer(): void {
    this.map.addSource('hillshade-source', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Hillshade: &copy; <a href="https://www.esri.com">Esri</a>',
    })
    this.map.addLayer({
      id: 'hillshade',
      type: 'raster',
      source: 'hillshade-source',
      layout: { visibility: this.hillshadeVisible() ? 'visible' : 'none' },
      paint: { 'raster-opacity': 0.5 },
    })
  }

  onToggleHillshade(event: MatSlideToggleChange): void {
    const checked = event.checked
    this.hillshadeVisible.set(checked)
    this.map.setLayoutProperty('hillshade', 'visibility', checked ? 'visible' : 'none')
  }

  private addReportsSource(): void {
    this.map.addSource(REPORTS_SOURCE_ID, {
      type: 'geojson',
      data: this.buildGeoJson(),
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    })

    this.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: REPORTS_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#2266aa',
        'circle-opacity': 0.75,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 20, 50, 28]
      }
    })

    this.map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: REPORTS_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        // F29-7/8 (2026-08-29): was a single hardcoded color for every report regardless of
        // which ranger filed it - "only as red dots, not as unique per ranger markers" was
        // the maintainer's exact complaint, and reading this code confirmed it directly: no
        // per-ranger marker system was ever built for MapLibre, unlike Leaflet's
        // rangerIconFor(). Data-driven off each feature's own `rangerColor` property
        // (buildGeoJson() resolves it per point, same rangerColorFor() Leaflet's markers and
        // trails already use), same treatment as `statusColor` below already gets. Distinct
        // per-ranger SHAPES (not just color) would need MapLibre's `symbol` layer type with
        // pre-registered images instead of a plain `circle` layer - a bigger change, not
        // attempted here; color alone already answers the complaint as reported.
        'circle-color': ['get', 'rangerColor'],
        'circle-radius': 8,
        // Raised live 2026-08-26: a status "shadow" ring, data-driven off each feature's own
        // `statusColor` property (buildGeoJson() resolves it per point) - same treatment as
        // the Leaflet markers' halo, same color lookup. Widened from a plain 2px white
        // outline to carry that color visibly.
        'circle-stroke-width': 4,
        'circle-stroke-color': ['get', 'statusColor']
      }
    })

    this.map.on('click', 'clusters', (ev) => this.onClusterClick(ev))
    this.map.on('click', 'unclustered-point', (ev) => this.onPointClick(ev))
    this.map.on('mouseenter', 'clusters', () => { this.map.getCanvas().style.cursor = 'pointer' })
    this.map.on('mouseleave', 'clusters', () => { this.map.getCanvas().style.cursor = '' })
    this.map.on('mouseenter', 'unclustered-point', () => { this.map.getCanvas().style.cursor = 'pointer' })
    this.map.on('mouseleave', 'unclustered-point', () => { this.map.getCanvas().style.cursor = '' })
  }

  private buildGeoJson(): FeatureCollection<Point, { title: string, statusColor: string, rangerColor: string }> {
    const reportsToShow = this.showingSelectedOnly
      ? this.radioLogService.getSelectedRadioLogEntries().logEntries
      : (this.radioLog?.logEntries ?? [])

    return {
      type: 'FeatureCollection',
      features: reportsToShow
        .filter((r: RadioLogEntryType) => r.location?.lat && r.location?.lng)
        .map((r: RadioLogEntryType) => {
          // Raised live 2026-08-26: a status "shadow" ring around each point, same color
          // lookup as the Leaflet markers (report-marker-status.ts). MapLibre's paint
          // expressions run in its own WebGL renderer, not the DOM/CSSOM, so a semantic
          // `var(--rt-status-*)` token has to be resolved to a concrete color up front -
          // resolveCssColorForCanvas() is exactly that, and a raw custom color passes
          // through unchanged either way. Falls back to a neutral grey (not the ring's own
          // default absence) so an unknown/blank status is visibly "unset," not silently
          // invisible in a paint expression that expects a string every time.
          const rawColor = radioLogStatusColor(r.status, this.settings.radioLogStatuses)
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [r.location.lng, r.location.lat] },
            properties: {
              title: `${r.callsign} at ${formatReportTime(r.date)} with ${r.status}`,
              statusColor: rawColor ? resolveCssColorForCanvas(rawColor) : '#888888',
              // F29-7/8: same identity key (rangerUid preferred, callsign fallback - D-42
              // phase 5) and same color function Leaflet's markers/trails already use, so a
              // ranger's dot is the same color on both map engines.
              rangerColor: rangerColorFor(r.rangerUid || r.callsign),
            }
          }
        })
    }
  }

  private refreshMarkers(): void {
    const source = this.map?.getSource<GeoJSONSource>(REPORTS_SOURCE_ID)
    if (!source) {
      return
    }
    source.setData(this.buildGeoJson())
  }

  private fitToBounds(): void {
    if (!this.radioLog || this.radioLog.numReport === 0) {
      return
    }
    const b = this.radioLog.bounds
    // MapLibre wants [[west, south], [east, north]] as [lng, lat] pairs
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40 })
  }

  /** P1-5: reads the currently-active custom file's own header once at map-init time, purely
   *  to know its bbox for flyToCustomArchiveIfOutsideView() below - onCustomPmtilesFileSelected()
   *  already validated the archive before it was ever stored, so a failure here (a device
   *  that had a file stored before this hardening landed, say) just means no fly-to, not a
   *  broken map. */
  private async loadCustomArchiveBounds(): Promise<void> {
    const file = this.customPmtiles.activeFile()
    if (!file) {
      this.customArchiveBounds = undefined
      return
    }
    try {
      const header = await new PMTiles(new FileSource(file)).getHeader()
      this.customArchiveBounds = [header.minLon, header.minLat, header.maxLon, header.maxLat]
    } catch (err) {
      this.log.warn(`loadCustomArchiveBounds(): could not read stored custom file's header: ${err}`, 'MapLibreComponent')
      this.customArchiveBounds = undefined
    }
  }

  /** P1-5(iv): if a custom file is active and the map's current center sits outside its own
   *  bbox, fly there. Only reachable via the 'load' handler right after fitToBounds() already
   *  had first claim on the camera - see that call site's own comment. */
  private flyToCustomArchiveIfOutsideView(): void {
    if (!this.customArchiveBounds) {
      return
    }
    const [minLon, minLat, maxLon, maxLat] = this.customArchiveBounds
    const center = this.map.getCenter()
    const inside = center.lng >= minLon && center.lng <= maxLon && center.lat >= minLat && center.lat <= maxLat
    if (inside) {
      return
    }
    this.map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40 })
  }

  onSwitchSelectedRadioLog(): void {
    this.showingSelectedOnly = !this.showingSelectedOnly
    if (this.showingSelectedOnly) {
      this.numSelectedRows.set(this.radioLogService.getSelectedRadioLogEntries().logEntries.length)
    }
    this.refreshMarkers()
  }

  private onClusterClick(ev: MapLayerMouseEvent): void {
    const features = this.map.queryRenderedFeatures(ev.point, { layers: ['clusters'] })
    const clusterId = features[0]?.properties?.['cluster_id']
    const source = this.map.getSource<GeoJSONSource>(REPORTS_SOURCE_ID)
    if (clusterId === undefined || !source) {
      return
    }
    source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
      const geometry = features[0].geometry
      if (geometry.type !== 'Point') {
        return
      }
      this.map.easeTo({ center: geometry.coordinates as [number, number], zoom })
    }).catch((e: unknown) => this.log.warn(`onClusterClick: ${e}`, 'MapLibreComponent'))
  }

  private onPointClick(ev: MapLayerMouseEvent): void {
    const feature = ev.features?.[0]
    if (!feature || feature.geometry.type !== 'Point') {
      return
    }
    const coordinates = feature.geometry.coordinates.slice() as [number, number]
    const title = String(feature.properties?.['title'] ?? '')
    new Popup().setLngLat(coordinates).setText(title).addTo(this.map)
  }

  private onMapClick(ev: MapMouseEvent): void {
    const hitMarker = this.map.queryRenderedFeatures(ev.point, { layers: ['clusters', 'unclustered-point'] })
    if (hitMarker.length > 0) {
      return
    }

    // ADR D-49: armed by the "Add Location" button. Takes over this one click instead of the
    // usual copy-to-clipboard, then disarms - see placingLocation's own comment for why.
    if (this.placingLocation()) {
      this.placingLocation.set(false)
      this.openLocationDialog(undefined, { lat: ev.lngLat.lat, lng: ev.lngLat.lng })
      return
    }

    const coords = `${Math.round(ev.lngLat.lat * 10000) / 10000}, ${Math.round(ev.lngLat.lng * 10000) / 10000}`
    navigator.clipboard.writeText(coords)
      .then(() => {
        const status = this.document.getElementById('map-status')
        if (status) {
          status.innerText = `${coords} copied to clipboard`
          Utility.resetMaterialFadeAnimation(status)
        }
      })
      .catch((err) => this.log.error(`onMapClick: coords NOT copied to clipboard: ${err}`, 'MapLibreComponent'))
  }

  /**
   * ADR D-49: redraws every Location marker from scratch - same "clear and rebuild" approach
   * refreshMarkers() takes for field reports, cheap at the count a mission's own location
   * list reaches. Guarded on `this.map`: the locations subscription (constructor) can fire
   * before the map exists (ReplaySubject(1) replays synchronously) - see its own comment.
   */
  private refreshLocationMarkers(): void {
    if (!this.map) {
      return
    }
    this.locationMarkers.forEach(m => m.remove())
    this.locationMarkers = this.locations.map(loc => {
      const color = locationCategoryColor(loc.type, this.settings.locationTypes)
      const el = document.createElement('div')
      el.className = 'rt-location-marker'
      el.innerHTML = locationMarkerSvg(loc.type, color)
      el.title = loc.name
      // MapLibre's marker element sits in the same container the map's own 'click' listener
      // is bound to (unlike Leaflet's synthetic event system) - without stopping propagation
      // here, clicking a location would ALSO fire onMapClick, copying its coordinates and,
      // worse, triggering the "place a new location" flow if placingLocation were armed.
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.openLocationDialog(loc)
      })
      return new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([loc.lng, loc.lat])
        .addTo(this.map)
    })
  }

  /**
   * E-11: draws the same purple-flag marker `mapLeaflet.component.ts`'s equivalent already
   * does for every report carrying an `evidenceLocation` - a scribe who has seen it once on
   * Entry (or the Leaflet engine) recognizes it instantly here too, rather than this engine
   * inventing a second look for the same meaning. Rebuilt wholesale on every radio-log
   * update, same as refreshLocationMarkers() - evidence points are rare enough per mission
   * that a full rebuild costs nothing worth optimizing away.
   */
  private refreshEvidenceMarkers(): void {
    if (!this.map) {
      return
    }
    this.evidenceMarkers.forEach(m => m.remove())
    this.evidenceMarkers = (this.radioLog?.logEntries ?? [])
      .filter((r): r is RadioLogEntryType & { evidenceLocation: NonNullable<RadioLogEntryType['evidenceLocation']> } =>
        !!r.evidenceLocation)
      .map(r => {
        const loc = r.evidenceLocation
        const el = document.createElement('div')
        el.className = 'rt-evidence-marker'
        el.innerHTML = evidenceMarkerSvg()
        el.title = `Evidence/clue from ${r.callsign} at ${formatReportTime(r.date)}`
        return new Marker({ element: el, anchor: 'bottom' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(this.map)
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
   * "Zoom to Extent" (maintainer ask, 2026-09-22): re-runnable, unlike the once-at-load
   * fitToBounds() above, which always covers the WHOLE log and ignores evidence markers and
   * Location pins entirely. Fits whatever is actually drawn right now.
   *
   * Reports are read back off buildGeoJson()'s own output rather than re-deriving the
   * All/selected filter a second time here - guarantees this always agrees with what's
   * actually on screen even if that filter logic changes later. Evidence is read straight off
   * the already-built Marker array (refreshEvidenceMarkers) for the same reason, which also
   * means this inherits that method's own pre-existing gap versus buildGeoJson(): it draws
   * from the WHOLE log's evidenceLocations, not honoring the All/selected switch (see its own
   * comment above) - a discrepancy with the Leaflet engine (whose displayMarkers() DOES honor
   * the switch for evidence), not something to silently fix as part of this task.
   */
  onBtnZoomToExtent(): void {
    const points: ExtentPoint[] = []
    for (const f of this.buildGeoJson().features) {
      const [lng, lat] = f.geometry.coordinates
      points.push({ lat, lng })
    }
    for (const m of this.evidenceMarkers) {
      const ll = m.getLngLat()
      points.push({ lat: ll.lat, lng: ll.lng })
    }
    this.locations.forEach(loc => points.push({ lat: loc.lat, lng: loc.lng }))

    const b = computeExtent(points)
    if (!b) {
      // Nothing to fit (empty mission, or the selected-only view filtered down to nothing) -
      // leave the camera where the operator left it rather than snapping to a default.
      this.log.info('onBtnZoomToExtent(): nothing to fit, leaving the camera alone', 'MapLibreComponent')
      return
    }
    // MapLibre wants [lng, lat] pairs, the reverse of Leaflet - fitToBounds() above already
    // documents this. maxZoom matters: without it, two reports 10m apart would slam to max zoom.
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, maxZoom: 16 })
  }

  ngOnDestroy(): void {
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
    this.locationsSubscription?.unsubscribe()
    this.locationMarkers.forEach(m => m.remove())
    this.retryDebounceTimersByMap.forEach(t => clearTimeout(t))
    this.overviewMap?.remove()
    this.map?.remove()
  }
}
