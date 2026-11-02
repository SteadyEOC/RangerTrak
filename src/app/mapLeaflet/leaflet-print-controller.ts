import * as L from 'leaflet'
import type { MarkerClusterGroup } from '@kristjan.esperanto/leaflet.markercluster'
import type { tileLayerOffline } from 'leaflet.offline'
import type { ElementRef, Signal, TemplateRef, WritableSignal } from '@angular/core'
import { edgeTickStep, formatEdgeTick, type CoordinateFormat } from '../domain/coordinate'
import {
  PrintPoint, PrintRect, choosePanelSpot, planFans, planBadges, padRect, BADGE_OVERLAP_PX,
} from '../domain/map-print-layout'
import { printMapSheet } from '../map/map-print/map-print-sheet'
import type { MissionType } from '../shared/services'
import type { MissionLocationType } from '../shared/services/mission-location.interface'
import type { LeafletOverlays } from './leaflet-overlays'

/** What LeafletPrintController needs from the map component (a narrow view, not the component itself). */
export interface LeafletPrintHost {
  /** The main Leaflet map (undefined until initMainMap() has built it). */
  map(): L.Map
  settings(): MissionType
  /** The cluster group the component owns (rebuilt by initMainMap()). */
  myMarkerCluster(): MarkerClusterGroup
  locationsLayer(): L.LayerGroup
  mapContainer(): ElementRef<HTMLDivElement>
  edgeTicks(): ElementRef<HTMLDivElement>
  printFrame(): ElementRef<HTMLDivElement>
  printTitle(): ElementRef<HTMLDivElement>
  printLegend(): ElementRef<HTMLElement>
  /** The Input template for the printed title block (undefined when the page gives none). */
  printTitleTemplate(): TemplateRef<unknown> | undefined
  readonly coordFormat: Signal<CoordinateFormat>
  /** True while Print map is loading the sharper tiles; template-bound, so the component owns it. */
  readonly printPreparing: WritableSignal<boolean>
  /** Which report marker each minutes badge belongs to; owned by the component (markers + print share them). */
  readonly badgeMarkers: Map<L.Tooltip, L.Marker>
  /** The component's change detection (it is ChangeDetectionStrategy.Eager). */
  detectChanges(): void
  /** The offline base layers (see the offline wiring), and whether every deeper tile is saved for one. */
  offlineTileLayers(): ReturnType<typeof tileLayerOffline>[]
  deeperTilesSaved(layer: L.TileLayer): Promise<boolean>
}

/**
 * Printing the Leaflet map: the print-media re-layout, edge ticks, sharp-tile preparation,
 * marker/ring changes for paper, fanning and the floating title/legend panels. Extracted from
 * mapLeaflet.component.ts (architecture pass, D-57) with the code unchanged. A plain class: the
 * component constructs it and owns its lifetime.
 */
export class LeafletPrintController {
  constructor(private readonly host: LeafletPrintHost, private readonly overlays: LeafletOverlays) { }

  private get lMap(): L.Map { return this.host.map() }
  private get settings(): MissionType { return this.host.settings() }
  private get myMarkerCluster() { return this.host.myMarkerCluster() }
  private get locationsLayer() { return this.host.locationsLayer() }
  private get mapContainer() { return this.host.mapContainer() }
  private get edgeTicks() { return this.host.edgeTicks() }
  private get printFrame() { return this.host.printFrame() }
  private get printTitle() { return this.host.printTitle() }
  private get printLegend() { return this.host.printLegend() }
  private get printTitleTemplate() { return this.host.printTitleTemplate() }
  private get coordFormat() { return this.host.coordFormat }
  private get printPreparing() { return this.host.printPreparing }
  private get badgeMarkers() { return this.host.badgeMarkers }
  private get myTrailsLayer() { return this.overlays.myTrailsLayer }
  private get rangeRingsLayer() { return this.overlays.rangeRingsLayer }

  /** Starts listening for the print layout taking over (the component's ngAfterViewInit). */
  attach(): void {
    this.printMedia?.addEventListener('change', this.onPrintMediaChange)
  }

  /** Stops listening (the component's ngOnDestroy). */
  dispose(): void {
    this.printMedia?.removeEventListener('change', this.onPrintMediaChange)
  }

  /**
   * 2026-09-30, John: E-152 - the printed sheet gives the map a different size from the
   * screen (see the @media print block in mapLeaflet.component.scss), and Leaflet only
   * re-measures its container on a window resize, which printing does not reliably fire.
   * The print media query flipping is the one signal every browser gives when the print
   * layout takes over and again when it hands back, so re-measure on both. invalidateSize()
   * keeps the map centred where it was.
   */
  private readonly printMedia = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('print') : undefined
  private readonly onPrintMediaChange = () => {
    // E-187 phase D: the Print card's places list prints a small map of its own (see
    // preparePlacesPrint). It has no title/legend panels, rings, fanning or edge ticks, so none
    // of the sheet layout below runs; the map only needs re-measuring at the printed box size.
    if (document.body.classList.contains('rt-print-places')) {
      this.lMap?.invalidateSize()
      this.edgeTicks?.nativeElement.replaceChildren()
      return
    }
    const printing = !!this.printMedia?.matches
    // 2026-10-01, John: E-152b - order matters. Markers become individual ones, the frame is
    // re-measured at the sheet's size, rings go on (at that size), the legend re-renders with
    // the ring line, markers fan out, and only then do the panels look for clear map (they
    // need the fanned positions), before the edge ticks step round the panels.
    if (!printing) {
      this.unfanPrintMarkers() // before the cluster takes its markers back, so it sees their real spots
    }
    this.setPrintMarkers(printing)
    this.setPrintRings(printing)
    this.lMap?.invalidateSize()
    if (printing && this.lMap) {
      if (this.printAddedRings) {
        this.overlays.refreshRangeRings()
      }
      this.host.detectChanges()
      this.layoutPrintSheet()
    } else {
      this.resetPrintSheet()
    }
    this.refreshEdgeTicks()
  }

  /**
   * 2026-09-30, John: lat/long ticks around the printed map's edge, the way a USGS quad marks
   * its margins: latitude labelled down the left edge, longitude along the top, a short mark
   * on all four sides. Written in DD when the readout is DD, otherwise in degrees and decimal
   * minutes (USNG already has its own grid overlay; DDM is what air operations read). Leaflet's
   * map is north-up Web Mercator, so latitudes are horizontal lines and longitudes vertical,
   * and one point per line places its tick exactly.
   *
   * Plain DOM written here rather than a template binding: it runs from the print media
   * change, right after invalidateSize() re-measures the map for the page, and has to be in
   * the document before the browser lays out the page - no waiting for change detection.
   * 2026-10-16, John ("no visible ticks here"): they show on screen too, redrawn after every pan
   * and zoom and when the readout format changes (the component calls refreshTicks()). A label
   * that would sit under the north arrow, a floating panel or any Leaflet control (zoom, layers,
   * scale bar, credits) is dropped; its tick mark stays.
   */
  refreshTicks(): void {
    if (!document.body.classList.contains('rt-print-places')) {
      this.refreshEdgeTicks()
    }
  }

  private refreshEdgeTicks(): void {
    const host = this.edgeTicks?.nativeElement
    if (!host) {
      return
    }
    host.replaceChildren()
    if (!this.lMap) {
      return
    }
    const size = this.lMap.getSize()
    if (!size.x || !size.y) {
      return
    }
    const view = this.lMap.getBounds()
    const format: 'DD' | 'DDM' = this.coordFormat() === 'DD' ? 'DD' : 'DDM'
    const labels: HTMLElement[] = []
    const add = (cls: string, style: Partial<CSSStyleDeclaration>, text?: string) => {
      const el = document.createElement('div')
      el.className = cls
      Object.assign(el.style, style)
      if (text) {
        el.textContent = text
        labels.push(el)
      }
      host.appendChild(el)
    }

    // About one tick per 100 px of edge (4 to 10). A fixed six left a landscape sheet's short
    // sides with only three latitude ticks (2026-10-16, from John's printed maps).
    const ticksFor = (px: number) => Math.max(4, Math.min(10, Math.round(px / 100)))
    const latStep = edgeTickStep(view.getNorth() - view.getSouth(), format, ticksFor(size.y))
    for (let k = Math.ceil(view.getSouth() / latStep); k * latStep <= view.getNorth(); k++) {
      const lat = k * latStep
      const y = this.lMap.latLngToContainerPoint([lat, view.getCenter().lng]).y
      add('map-edge-ticks__mark map-edge-ticks__mark--left', { top: `${y}px` })
      add('map-edge-ticks__mark map-edge-ticks__mark--right', { top: `${y}px` })
      add('map-edge-ticks__label map-edge-ticks__label--left', { top: `${y}px` },
        formatEdgeTick(lat, false, format, latStep))
    }
    const lngStep = edgeTickStep(view.getEast() - view.getWest(), format, ticksFor(size.x))
    for (let k = Math.ceil(view.getWest() / lngStep); k * lngStep <= view.getEast(); k++) {
      const lng = k * lngStep
      const x = this.lMap.latLngToContainerPoint([view.getCenter().lat, lng]).x
      add('map-edge-ticks__mark map-edge-ticks__mark--top', { left: `${x}px` })
      add('map-edge-ticks__mark map-edge-ticks__mark--bottom', { left: `${x}px` })
      add('map-edge-ticks__label map-edge-ticks__label--top', { left: `${x}px` },
        formatEdgeTick(lng, true, format, lngStep))
    }

    const frame = host.parentElement
    const blockers = frame
      ? [...frame.querySelectorAll('.furniture, .leaflet-control, .map-print-panel')]
        .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
      : []
    const box = host.getBoundingClientRect()
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    for (const label of labels) {
      const r = label.getBoundingClientRect()
      const outside = r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom
      if (outside || blockers.some(b => overlaps(r, b))) {
        label.remove()
      }
    }
  }


  /**
   * G (2026-09-28, John: AAR note): the Map page already had print CSS for
   * `.map-print-header` (map-page.component.scss) but no button to trigger it. Same
   * body-class technique as Radio Log's ICS-309 print and After Action's own onPrint():
   * hides the app chrome (navbar/banners/footer/page header) for the duration of the print
   * only - the map tiles themselves need no special handling here, unlike MapLibre's own
   * copy of this method (see mapLibre.component.ts's onBtnPrintMap for why that engine
   * does).
   */
  async onBtnPrintMap(): Promise<void> {
    if (this.printPreparing()) {
      return
    }
    const undo = await this.prepareSharpPrint()
    // 2026-09-30, John: E-152 - the body class, and now a landscape page, live in the shared
    // helper so both engines print the same sheet.
    const started = Date.now()
    printMapSheet(this.settings)
    // window.print() blocks until the dialog closes in desktop browsers, so the map can be put
    // back straight away. Where it returns at once, wait for afterprint instead, and as a last
    // resort the next tap or click (a browser that never fires afterprint must not leave the
    // map stuck in its print state).
    if (Date.now() - started > 500) {
      undo()
    } else {
      window.addEventListener('afterprint', undo, { once: true })
      setTimeout(() => document.addEventListener('pointerdown', undo, { once: true }), 1000)
    }
  }


  /**
   * E-187 Layers phase D (ADR D-58): the small map at the top of the Print card's places sheet.
   * Not an image (tile canvases are cross-origin): the live map is printed, as Print map does,
   * only smaller. Before the print dialog opens this
   * - sizes the map like its printed box (`rt-print-places-prep`, see the scss),
   * - shows only the places being printed (the other places, the radio log entries and the ranger
   *   paths are taken off for the print; grids and rings the user switched on stay),
   * - fits the map to those places with some padding, and
   * - waits for the tiles it now needs (at most 6 s).
   * Returns the function that puts the map and its markers back as they were.
   */
  async preparePlacesPrint(places: readonly MissionLocationType[]): Promise<() => void> {
    const map = this.lMap
    if (!map || !places.length) {
      return () => { }
    }
    const view = { center: map.getCenter(), zoom: map.getZoom() }
    document.body.classList.add('rt-print-places-prep')
    map.invalidateSize()

    const keyOf = (lat: number, lng: number, name: string) => `${lat},${lng},${name}`
    const wanted = new Set(places.map(p => keyOf(p.lat, p.lng, p.name)))
    const hiddenPlaces: L.Layer[] = []
    this.locationsLayer.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        const at = layer.getLatLng()
        if (!wanted.has(keyOf(at.lat, at.lng, layer.options.title ?? ''))) {
          hiddenPlaces.push(layer)
        }
      }
    })
    hiddenPlaces.forEach(layer => this.locationsLayer.removeLayer(layer))
    const locationsWereOff = !map.hasLayer(this.locationsLayer)
    if (locationsWereOff) {
      map.addLayer(this.locationsLayer)
    }
    // The radio log's entries and ranger paths (with their minutes badges) are not part of a places list.
    const entriesWereOn = map.hasLayer(this.myMarkerCluster)
    if (entriesWereOn) {
      map.removeLayer(this.myMarkerCluster)
    }
    const trailsWereOn = map.hasLayer(this.myTrailsLayer)
    if (trailsWereOn) {
      map.removeLayer(this.myTrailsLayer)
    }

    map.fitBounds(new L.LatLngBounds(places.map(p => [p.lat, p.lng] as [number, number])),
      { padding: [28, 28], maxZoom: 15, animate: false })
    await this.waitForTiles(6000)

    let undone = false
    return () => {
      if (undone || !this.lMap) {
        return
      }
      undone = true
      document.body.classList.remove('rt-print-places-prep')
      hiddenPlaces.forEach(layer => this.locationsLayer.addLayer(layer))
      if (locationsWereOff) {
        map.removeLayer(this.locationsLayer)
      }
      if (entriesWereOn) {
        map.addLayer(this.myMarkerCluster)
      }
      if (trailsWereOn) {
        map.addLayer(this.myTrailsLayer)
      }
      map.invalidateSize()
      map.setView(view.center, view.zoom, { animate: false })
    }
  }

  /** Resolves once the map has no tile still loading, or after `maxMs`. */
  private async waitForTiles(maxMs: number): Promise<void> {
    const root = this.mapContainer?.nativeElement
    const started = Date.now()
    await new Promise(r => setTimeout(r, 150)) // let Leaflet ask for the tiles the new view needs
    while (root && Date.now() - started < maxMs
      && root.querySelector('.leaflet-tile-pane .leaflet-tile:not(.leaflet-tile-loaded)')) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  /**
   * 2026-09-30, John: "printers show more resolution than screens" - base-map tiles are
   * screen-resolution pictures, so they printed soft while everything drawn on top (markers,
   * trails, rings, grid, ticks, text) printed sharp. Before the print dialog opens, this sizes
   * the map like the printed sheet (`rt-print-prep`, see the scss), then reloads every tile
   * layer on the map one zoom level deeper at half size (tileSize 128, zoomOffset 1): twice
   * the detail in the same place on paper. It waits for those tiles (at most 8 s, the button
   * says "Preparing...") so the print doesn't catch them half-loaded.
   *
   * Offline (2026-10-01, John: "Why is the offline map lower resolution?"): the deeper tiles
   * can only come from the tiles saved on this device. "Save this area" already keeps two
   * deeper zoom levels (LEAFLET_SAVE_EXTRA_ZOOM_LEVELS), so they are often there. Each offline
   * base layer is sharpened only if EVERY deeper tile the printed area needs is saved
   * (deeperTilesSaved()); otherwise it prints as sharp as the screen, never patchy with blank
   * squares. Online-only overlays (hillshade, trails, satellite) draw nothing offline anyway
   * and are left alone. Returns the function that puts the map back.
   */
  private async prepareSharpPrint(): Promise<() => void> {
    if (!this.lMap) {
      return () => { }
    }
    const online = navigator.onLine
    this.printPreparing.set(true)
    document.body.classList.add('rt-print-prep')
    this.lMap.invalidateSize()
    type Saved = { layer: L.TileLayer, tileSize: L.TileLayerOptions['tileSize'], zoomOffset?: number, maxNativeZoom?: number }
    const saved: Saved[] = []
    const candidates: L.TileLayer[] = []
    // 2026-10-05, John: the prep size is larger than the printed map (see the scss), so the tiles
    // past the printed edge must survive the print-time invalidateSize(): Leaflet drops tiles more
    // than keepBuffer tiles outside the view, and a smaller dialog Scale needs them back at once.
    const keepBuffers = new Map<L.GridLayer, number | undefined>()
    this.lMap.eachLayer(layer => {
      if (layer instanceof L.GridLayer) {
        const o = layer.options as L.GridLayerOptions
        keepBuffers.set(layer, o.keepBuffer)
        o.keepBuffer = 100
      }
    })
    this.lMap.eachLayer(layer => {
      if (layer instanceof L.TileLayer
        && (online || (this.host.offlineTileLayers() as L.TileLayer[]).includes(layer))) {
        candidates.push(layer)
      }
    })
    for (const layer of candidates) {
      if (online || await this.host.deeperTilesSaved(layer)) {
        const o = layer.options
        saved.push({ layer, tileSize: o.tileSize, zoomOffset: o.zoomOffset, maxNativeZoom: o.maxNativeZoom })
      }
    }
    const loads = saved.map(({ layer }) => new Promise<void>(resolve => layer.once('load', () => resolve())))
    for (const { layer, maxNativeZoom } of saved) {
      const o = layer.options
      const native = maxNativeZoom ?? o.maxZoom ?? 18
      o.tileSize = 128
      o.zoomOffset = (o.zoomOffset ?? 0) + 1
      o.maxNativeZoom = native - 1 // so the deeper request never asks past the server's last level
      this.lMap.removeLayer(layer)
      this.lMap.addLayer(layer)
    }
    await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 8000))])
    // 2026-10-16 (John's prints at 65%): leaving rt-print-prep on through the print made Chrome lay
    // the sheet out 1.5x the paper and shrink it to fit (print check: content 1470 px for a 980 px
    // page), and made headless printing hang. The prep size is only for fetching the tiles; with
    // keepBuffer raised above they survive the map shrinking back, so drop it before printing.
    document.body.classList.remove('rt-print-prep')
    this.lMap.invalidateSize()
    this.printPreparing.set(false)

    let undone = false
    return () => {
      if (undone || !this.lMap) {
        return
      }
      undone = true
      keepBuffers.forEach((keepBuffer, layer) => { (layer.options as Partial<L.GridLayerOptions>).keepBuffer = keepBuffer })
      for (const { layer, tileSize, zoomOffset, maxNativeZoom } of saved) {
        Object.assign(layer.options, { tileSize, zoomOffset, maxNativeZoom })
        if (this.lMap.hasLayer(layer)) {
          this.lMap.removeLayer(layer)
          this.lMap.addLayer(layer)
        }
      }
      document.body.classList.remove('rt-print-prep')
      this.lMap.invalidateSize()
    }
  }


  /**
   * 2026-09-30, John: "Pdf can zoom, so should we turn off grouped markers on the printed
   * map?" Yes: a group can't be clicked open on paper or in a PDF. While printing, every
   * marker moves from the cluster group to a plain layer, and back afterwards. Runs from the
   * print media change, so Ctrl+P gets it too, not just the Print map button.
   */
  private readonly printMarkers = new L.LayerGroup()
  /** True while the print swap moves markers between the cluster and plain layers; layer events then are not the user's choice. */
  swappingMarkers = false
  private setPrintMarkers(printing: boolean): void {
    if (!this.lMap) {
      return
    }
    this.swappingMarkers = true
    try {
      this.swapPrintMarkers(printing)
    } finally {
      this.swappingMarkers = false
    }
  }

  private swapPrintMarkers(printing: boolean): void {
    if (!this.lMap) {
      return
    }
    if (printing && this.lMap.hasLayer(this.myMarkerCluster)) {
      const markers = this.myMarkerCluster.getLayers()
      this.lMap.removeLayer(this.myMarkerCluster)
      markers.forEach(m => this.printMarkers.addLayer(m))
      this.printMarkers.addTo(this.lMap)
    } else if (!printing && this.lMap.hasLayer(this.printMarkers)) {
      this.printMarkers.clearLayers()
      this.lMap.removeLayer(this.printMarkers)
      this.lMap.addLayer(this.myMarkerCluster)
    }
  }

  /**
   * 2026-10-01, John: E-152b - range rings always print: a printed map has no layers menu to
   * switch them on later, and distance from the command post is what a paper map is read for.
   * If the user already had them on they are left alone; otherwise they are added for the
   * print and taken off after, so the screen map ends up as the user left it. Adding the layer
   * fires the same overlayadd handler the menu does, so the legend gets its rings line.
   */
  private printAddedRings = false
  private setPrintRings(printing: boolean): void {
    if (!this.lMap) {
      return
    }
    if (printing && !this.lMap.hasLayer(this.rangeRingsLayer)) {
      this.lMap.addLayer(this.rangeRingsLayer)
      this.printAddedRings = true
    } else if (!printing && this.printAddedRings) {
      this.printAddedRings = false
      this.lMap.removeLayer(this.rangeRingsLayer)
    }
  }

  /**
   * 2026-10-01, John: E-152b - markers at (nearly) the same spot print fanned out: each group
   * of two or more spreads round a circle centred on the group's true point, a thin leader
   * line from every marker back to that point, and a small dot on it, the way a callout
   * infographic does it. The markers keep their real latlngs in `fanned` so the screen map is
   * restored exactly; the leaders and dots live in their own layer. Trails keep true positions.
   */
  private readonly fanned = new Map<L.Marker, L.LatLng>()
  // 2026-10-01, John: E-152b - what each minutes badge looked like before it moved (the
  // badge-to-marker map, badgeMarkers, is the component's).
  private readonly movedBadges = new Map<L.Tooltip, L.LatLng>()
  private readonly fanLayer = new L.LayerGroup()

  /**
   * 2026-10-16 (John's prints, Windows display scale 150%): in a real print, getBoundingClientRect()
   * came back at 2/3 of the CSS px Leaflet and style.left/top work in (print check: map 630 px
   * measured, 945 px laid out), so the legend was measured too small and printed over the title.
   * Every measurement the print layout takes goes through this, so all of it is in the map
   * container's CSS px. The ratio is 1 on screen and wherever the two agree.
   */
  private containerRect(): (r: DOMRect) => PrintRect {
    const map = this.mapContainer.nativeElement
    const origin = map.getBoundingClientRect()
    const k = origin.width && map.offsetWidth ? map.offsetWidth / origin.width : 1
    return r => ({
      left: (r.left - origin.left) * k, top: (r.top - origin.top) * k,
      right: (r.right - origin.left) * k, bottom: (r.bottom - origin.top) * k,
    })
  }

  private fanPrintMarkers(): void {
    this.unfanPrintMarkers()
    const markers = this.printMarkers.getLayers() as L.Marker[]
    const points = markers.map(m => this.lMap.latLngToContainerPoint(m.getLatLng()))
    // What stays put and must not be fanned onto: the Location icons. (The minutes badges travel
    // with their report, see placeBadges().)
    const rel = this.containerRect()
    const fixed: PrintRect[] = []
    const keep = (el: Element | undefined | null) => {
      const r = el?.getBoundingClientRect()
      if (r && r.width && r.height) {
        fixed.push(padRect(rel(r), 1))
      }
    }
    this.locationsLayer.eachLayer(l => keep((l as L.Marker).getElement?.()))

    // The printed icon is a scaled-down svg inside the 28 px icon box (see the scss), so measure
    // that, now that the print styles are on: the grouping and spacing follow the printed size.
    const sample = markers.map(m => {
      const r = m.getElement()?.querySelector('svg')?.getBoundingClientRect()
      return r && r.width ? rel(r).right - rel(r).left : 0
    }).find(w => !!w)
    const plan = planFans(points, { icon: sample || undefined, fixed })
    const dots = new Set<string>()
    for (const group of plan.groups) {
      for (const i of group.members) {
        // Each marker's leader runs to its OWN true spot; one dot per distinct spot.
        const marker = markers[i]
        const truth = marker.getLatLng()
        const at = this.lMap.containerPointToLatLng(new L.Point(plan.positions[i].x, plan.positions[i].y))
        this.fanned.set(marker, truth)
        marker.setLatLng(at)
        this.fanLayer.addLayer(new L.Polyline([truth, at], { color: '#222', weight: 1, interactive: false, className: 'rt-fan-leader' }))
        const key = `${Math.round(points[i].x)},${Math.round(points[i].y)}`
        if (!dots.has(key)) {
          dots.add(key)
          this.fanLayer.addLayer(new L.CircleMarker(truth, {
            radius: 3, color: '#fff', weight: 1, fillColor: '#222', fillOpacity: 1, interactive: false,
          }))
        }
      }
    }
    if (this.fanned.size) {
      this.fanLayer.addTo(this.lMap)
    }
    this.placeBadges()
  }

  /**
   * 2026-10-01, John: E-152b - "locate them with the report": while printing, each minutes
   * badge moves onto its ranger's newest report marker (where that marker is drawn now, fanned
   * or not), above it as on screen. Where that collides (see planBadges()) it goes to another
   * side of its icon, and if need be all badges shrink a step. Put back by unfanPrintMarkers().
   */
  private placeBadges(): void {
    const map = this.mapContainer.nativeElement
    const toMap = this.containerRect()
    const rel = (el: Element | null | undefined): PrintRect | null => {
      const r = el?.getBoundingClientRect()
      return r && r.width && r.height ? toMap(r) : null
    }
    const iconOf = (m: L.Marker) => rel(m.getElement()?.querySelector('svg') ?? m.getElement())
    const items: { badge: L.Tooltip, marker: L.Marker, size: { width: number, height: number } }[] = []
    this.badgeMarkers.forEach((marker, badge) => {
      if (!this.printMarkers.hasLayer(marker)) {
        return
      }
      this.movedBadges.set(badge, badge.getLatLng()!)
      badge.options.direction = 'top'
      badge.options.offset = new L.Point(0, -BADGE_OVERLAP_PX)
      badge.setLatLng(marker.getLatLng())
      const r = rel(badge.getElement())
      items.push({ badge, marker, size: { width: r ? r.right - r.left : 0, height: r ? r.bottom - r.top : 0 } })
    })
    if (!items.length) {
      return
    }
    // Every report icon (own and others') and every Location icon, in container px.
    const markers = this.printMarkers.getLayers() as L.Marker[]
    const icons: PrintRect[] = []
    const indexOf = new Map<L.Marker, number>()
    markers.forEach(m => {
      const r = iconOf(m)
      if (r) {
        indexOf.set(m, icons.length)
        icons.push(r)
      }
    })
    const fixed: PrintRect[] = []
    this.locationsLayer.eachLayer(l => {
      const r = rel((l as L.Marker).getElement?.())
      if (r) {
        fixed.push(r)
      }
    })
    const usable = items.filter(it => indexOf.has(it.marker))
    const plan = planBadges(usable.map(it => ({ iconIndex: indexOf.get(it.marker)!, size: it.size })), icons, fixed)
    map.style.setProperty('--rt-badge-scale', String(plan.scale))
    usable.forEach((it, k) => {
      const side = plan.sides[k]
      it.badge.options.direction = side
      it.badge.options.offset = side === 'top' ? new L.Point(0, -BADGE_OVERLAP_PX) : side === 'bottom' ? new L.Point(0, BADGE_OVERLAP_PX)
        : side === 'left' ? new L.Point(-BADGE_OVERLAP_PX, 0) : new L.Point(BADGE_OVERLAP_PX, 0)
      it.badge.setLatLng(it.marker.getLatLng())
    })
  }

  private unfanPrintMarkers(): void {
    this.fanned.forEach((latlng, marker) => marker.setLatLng(latlng))
    this.fanned.clear()
    this.movedBadges.forEach((latlng, badge) => {
      badge.options.direction = 'top'
      badge.options.offset = new L.Point(0, -8)
      badge.setLatLng(latlng)
    })
    this.movedBadges.clear()
    this.mapContainer?.nativeElement.style.removeProperty('--rt-badge-scale')
    this.fanLayer.clearLayers()
    if (this.lMap?.hasLayer(this.fanLayer)) {
      this.lMap.removeLayer(this.fanLayer)
    }
  }

  /**
   * 2026-10-01, John: E-152b - lays out the printed sheet: fans the markers, then floats the
   * title and the legend over the map in clear spots (title first, so the legend avoids it).
   * A spot is allowed only if it covers no report or location marker (or its minutes badge),
   * the north arrow, scale bar or credits; of the allowed ones the one crossing the fewest
   * trails and ring labels wins (choosePanelSpot). Only vector things are weighed - the map
   * tiles are other sites' pictures whose pixels cannot be read.
   *
   * When no spot is clear (a crowded map): the title goes back to a band above the map
   * (rt-print-title-band), which changes the map's size, so the map is re-measured and the
   * markers re-fanned and the pass repeats. The legend instead prints whole at the top of page 2
   * (John: "going to a 2 page map is fine"): the map keeps its full size on page 1, "Prepared
   * by" stays under it, and the legend element is moved to follow that line (a CSS page break
   * puts it on the next sheet) and moved back after printing.
   */
  private layoutPrintSheet(): void {
    const frame = this.printFrame.nativeElement
    const title = this.printTitle.nativeElement
    const legend = this.printLegend.nativeElement
    const hasTitle = !!this.printTitleTemplate
    let titleBand = false
    let legendOnPage2 = false
    this.putLegendHome()
    const inset = 3 / 25.4 * 96 // 3 mm, in CSS px
    let titleSpot: { left: number, top: number } | null = null
    let legendSpot: { left: number, top: number } | null = null

    for (let pass = 0; pass < 3; pass++) {
      frame.classList.toggle('rt-print-title-band', titleBand)
      for (const el of [title, legend]) {
        el.style.left = '0'
        el.style.top = '0'
        el.style.removeProperty('right')
        el.style.removeProperty('bottom')
      }
      frame.style.removeProperty('--rt-print-band')
      legend.classList.add('legend--compact')
      legend.style.removeProperty('width')
      if (titleBand) {
        frame.style.setProperty('--rt-print-band', `${title.offsetHeight}px`)
      }
      this.lMap.invalidateSize()
      this.fanPrintMarkers()

      const rel = this.containerRect()
      const map = this.mapContainer.nativeElement
      const visible = (selector: string, pad: number) => [...frame.querySelectorAll(selector)]
        .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
        .map(r => padRect(rel(r), pad))
      const hard = [
        ...visible('.leaflet-marker-icon:not(.rt-range-ring-label) > svg, .leaflet-marker-icon:not(.rt-range-ring-label):not(.rt-ranger-marker):not(.rt-evidence-marker)', 3),
        ...visible('.leaflet-tooltip', 3),
        ...visible('.furniture, .leaflet-control-scale, .leaflet-control-attribution', 2),
      ]
      const soft = visible('.rt-range-ring-label span', 0)
      const segments: [PrintPoint, PrintPoint][] = []
      this.myTrailsLayer.eachLayer(layer => {
        if (layer instanceof L.Polyline) {
          const pts = (layer.getLatLngs() as L.LatLng[]).map(ll => this.lMap.latLngToContainerPoint(ll))
          for (let i = 1; i < pts.length; i++) {
            segments.push([pts[i - 1], pts[i]])
          }
        }
      })
      const container = { width: map.offsetWidth, height: map.offsetHeight }
      // The scale bar and credits run along the bottom edge: panels sit above them.
      const credits = visible('.leaflet-control-scale, .leaflet-control-attribution', 0)
      const bottomExtra = credits.length ? Math.max(0, container.height - Math.min(...credits.map(r => r.top))) : 0
      const place = (el: HTMLElement, extraHard: PrintRect[]) => {
        const r = rel(el.getBoundingClientRect())
        return choosePanelSpot({
          container, panel: { width: r.right - r.left, height: r.bottom - r.top }, inset, bottomExtra,
          hard: [...hard, ...extraHard], soft, segments,
        })
      }

      if (hasTitle && !titleBand) {
        titleSpot = place(title, [])
        if (!titleSpot) {
          titleBand = true
          continue
        }
      }
      {
        const tr = { width: title.offsetWidth, height: title.offsetHeight }
        const withTitle = hasTitle && !titleBand && titleSpot
          ? [padRect({ left: titleSpot.left, top: titleSpot.top, right: titleSpot.left + tr.width, bottom: titleSpot.top + tr.height }, 3)] : []
        // A wider, shorter legend (three or four columns) gets a chance before page 2.
        legendSpot = null
        for (const widthMm of [92, 134, 176]) {
          legend.style.width = `${widthMm}mm`
          legendSpot = place(legend, withTitle)
          if (legendSpot) {
            break
          }
        }
        if (!legendSpot) {
          legendOnPage2 = true
        }
      }
      break
    }

    if (legendOnPage2) {
      legend.style.removeProperty('width')
      legend.style.removeProperty('left')
      legend.style.removeProperty('top')
      legend.classList.add('map-print-panel--page2')
      // After the "Prepared by" line, so that stays on page 1 under the map.
      const footer = document.querySelector('.map-print-footer')
      if (footer) {
        footer.insertAdjacentElement('afterend', legend)
      } else {
        frame.insertAdjacentElement('afterend', legend)
      }
    }
    if (titleSpot && !titleBand) {
      this.pinPanel(title, titleSpot)
    }
    if (legendSpot && !legendOnPage2) {
      this.pinPanel(legend, legendSpot)
    }
  }

  /**
   * 2026-10-16, John's blank second sheet: a real print dialog lays the sheet out several times,
   * starting wider and taller than the paper and settling (print check: frame 1281 -> 963 px
   * wide), and this layout can run in one of the bigger passes. A legend placed at top 505 px in a
   * 928 px frame then hung 150 px below the 683 px one on paper and started a second sheet
   * (print-map-sheet.js --start-width). So a panel is held from its nearest edges: in the lower
   * half by its distance from the bottom, in the right half from the right. A corner panel stays
   * in its corner whatever size the frame ends up.
   */
  private pinPanel(el: HTMLElement, spot: { left: number, top: number }): void {
    const frame = this.printFrame.nativeElement
    const w = el.offsetWidth
    const h = el.offsetHeight
    const fromRight = spot.left + w / 2 > frame.clientWidth / 2
    const fromBottom = spot.top + h / 2 > frame.clientHeight / 2
    el.style.left = fromRight ? 'auto' : `${spot.left}px`
    el.style.right = fromRight ? `${Math.max(0, frame.clientWidth - spot.left - w)}px` : ''
    el.style.top = fromBottom ? 'auto' : `${spot.top}px`
    el.style.bottom = fromBottom ? `${Math.max(0, frame.clientHeight - spot.top - h)}px` : ''
  }

  /** The legend lives inside the map frame; page 2 borrows it (see layoutPrintSheet()). */
  private putLegendHome(): void {
    const legend = this.printLegend?.nativeElement
    const frame = this.printFrame?.nativeElement
    legend?.classList.remove('map-print-panel--page2')
    if (legend && frame && legend.parentElement !== frame) {
      frame.appendChild(legend)
    }
  }

  /** Puts the screen map back after printing: markers home, panels and fallback classes off. */
  private resetPrintSheet(): void {
    this.unfanPrintMarkers()
    const frame = this.printFrame?.nativeElement
    this.putLegendHome()
    frame?.classList.remove('rt-print-title-band')
    frame?.style.removeProperty('--rt-print-band')
    this.printLegend?.nativeElement.classList.remove('legend--compact')
    this.printLegend?.nativeElement.style.removeProperty('width')
    for (const el of [this.printTitle?.nativeElement, this.printLegend?.nativeElement]) {
      for (const side of ['left', 'top', 'right', 'bottom']) {
        el?.style.removeProperty(side)
      }
    }
  }
}
