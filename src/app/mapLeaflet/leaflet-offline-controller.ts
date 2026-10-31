import * as L from 'leaflet'
import {
  downloadTile, getStorageInfo, getStoredTilesAsJson, getTileImageSource, getTilePoints, getTileUrl, hasTile, saveTile, savetiles,
  tileLayerOffline
} from 'leaflet.offline' // https://github.com/allartk/leaflet.offline
import type { SaveStatus } from 'leaflet.offline'
import type { ElementRef, WritableSignal } from '@angular/core'
import type { LogService } from '../shared/services'

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

// How many zoom levels up a missing USGS shaded relief tile may borrow from (see below).
const RELIEF_FALLBACK_LEVELS = 4

/**
 * 2026-10-01, John: the USGS shaded relief's tile cache has holes that differ by place (near
 * Vashon zooms 9-11 are missing, near Denver only 9, Atlanta none - surveyed with curl), so no
 * fixed zoom setting can fill them. Tile by tile instead: when a tile is missing, the nearest
 * parent tile (up to RELIEF_FALLBACK_LEVELS up) is drawn enlarged, cropped to this tile's
 * quarter, so the shading never shows holes anywhere in the country. Saved tiles are used first
 * (getTileImageSource), so it works offline for whatever saveReliefTiles() kept. If no level
 * has a tile, the spot is left empty without raising a tile error.
 */
function reliefTileWithFallback(layer: L.TileLayer, coords: L.Coords, done: L.DoneCallback): HTMLElement {
  const tile = document.createElement('div')
  tile.style.overflow = 'hidden'
  const url = (layer as unknown as { _url: string })._url
  const size = layer.getTileSize().x
  const urlZoom = coords.z + (layer.options.zoomOffset ?? 0)
  const tryLevel = (up: number) => {
    const z = urlZoom - up
    if (up > RELIEF_FALLBACK_LEVELS || z < 0) {
      done(undefined, tile)
      return
    }
    const scale = 2 ** up
    const x = Math.floor(coords.x / scale)
    const y = Math.floor(coords.y / scale)
    const src = getTileUrl(url, { ...layer.options, x, y, z })
    const img = document.createElement('img')
    img.alt = ''
    img.style.position = 'absolute'
    img.style.width = img.style.height = `${size * scale}px`
    img.style.left = `${-(coords.x - x * scale) * size}px`
    img.style.top = `${-(coords.y - y * scale) * size}px`
    img.onload = () => done(undefined, tile)
    img.onerror = () => { img.remove(); tryLevel(up + 1) }
    tile.appendChild(img)
    getTileImageSource(src, src).then(s => { img.src = s }).catch(() => { img.src = src })
  }
  tryLevel(0)
  return tile
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


/** What LeafletOfflineController needs from the map component (a narrow view, not the component itself). */
export interface LeafletOfflineHost {
  /** The main Leaflet map (undefined until initMainMap() has built it). */
  map(): L.Map
  log(): LogService
  id(): string
  document(): Document
  /** The template's #offlineControlsHost div, where the save control's DOM is re-parented. */
  offlineControlsHost(): ElementRef<HTMLDivElement>
  /** Template-bound ("Zoom to offline tiles" button), so the component owns them. */
  readonly hasOfflineTiles: WritableSignal<boolean>
  readonly offlineTilesShown: WritableSignal<boolean>
  /** A short line in the status text under the map. */
  note(text: string): void
}

/**
 * The Leaflet map's offline tiles: the tileLayerOffline base layers, the "Save this area" /
 * "Remove saved tiles" control and its size estimate, the USGS shaded relief save, the saved-area
 * overlay and the "deeper tiles saved" check the sharp print uses. Extracted from
 * mapLeaflet.component.ts (architecture pass, D-57) with the code unchanged. A plain class: the
 * component constructs it and owns its lifetime.
 */
export class LeafletOfflineController {
  constructor(private readonly host: LeafletOfflineHost) { }

  private get lMap(): L.Map { return this.host.map() }
  private get log(): LogService { return this.host.log() }
  private get id(): string { return this.host.id() }
  private get document(): Document { return this.host.document() }
  private get offlineControlsHost() { return this.host.offlineControlsHost() }
  private get hasOfflineTiles() { return this.host.hasOfflineTiles }
  private get offlineTilesShown() { return this.host.offlineTilesShown }

  // Offline-area sizing: kept for teardown (.off()) in ngOnDestroy, since these listeners
  // are registered directly on the layer/map objects, not through Angular's own bindings.
  // F29-6 (2026-08-29): "Save this area" used to be permanently bound to OSM only - now
  // tracks EVERY tileLayerOffline base layer (OSM and OpenTopoMap) so both get saveend/
  // tilesremoved listeners and both get torn down here, not just whichever was active last.
  offlineTileLayers: ReturnType<typeof tileLayerOffline>[] = []
  private refreshSavedAreaInfo?: () => void
  refreshEstimatedAreaInfo?: () => void
  private refreshSavedTilesOverlay?: () => void
  // 2026-09-30, John: E-138 - the blue saved-area overlay used to be a layers-menu checkbox
  // ("Saved offline tiles"); it is now driven by the "Zoom to offline tiles" button under the
  // map. `savedTilesLayer` is the same L.geoJSON, just no longer in the layers control.
  // `hasOfflineTiles` mirrors whether it has any features (kept current by
  // refreshSavedTilesOverlay), `offlineTilesShown` is the button's on state.
  private savedTilesLayer?: L.GeoJSON
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
  // 2026-09-30, John: E-162 - the satellite base layer is online-only and not offered for saving.
  private satelliteBaseActive = false

  /**
   * Builds the offline-capable layers initMainMap() puts in the layer switcher: the OSM and
   * OpenTopoMap base layers, the USGS aerial photos and shaded relief, and the saved-area overlay.
   * Nothing is added to the map here.
   */
  createLayers() {
    // tileLayerOffline (not plain L.tileLayer) caches tiles in IndexedDB as they're
    // viewed, and the savetiles control below lets a user explicitly save the visible
    // area for offline use - giving this engine a real offline story to compare against
    // the PMTiles map, rather than the previously-unused `leaflet.offline` import.
    const tiles = tileLayerOffline('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21,  // Past OSM's native 19 Leaflet just enlarges tiles; not worth a setting (#81)
      minZoom: 3,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    })

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

    // 2026-10-01, John: "Can we offer ability to save hillshade, satellite, etc. layers too?"
    // Esri's terms don't allow saving its imagery or hillshade for offline use, so those stay
    // online only. The US government's National Map (USGS) is public-domain data with no API
    // key: its aerial photos (tiles to zoom 16, mostly 1 m NAIP imagery in the lower 48) and
    // its shaded relief (to zoom 13) are tileLayerOffline layers, so they auto-cache as viewed
    // and can be saved with "Save this area" (the relief rides along with the base layer's
    // save, see saveReliefTiles()). US only. Both URLs checked with curl (JPEG tiles, ~30 KB
    // for photos). The relief is an opaque grey JPEG, hence the reduced opacity, as with the
    // Esri hillshade above.
    const usgsImageryTiles = tileLayerOffline(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      {
        maxNativeZoom: 16, maxZoom: 19, minZoom: 3,
        attribution: 'Aerial photos: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>, USDA NAIP',
      }
    )
    const usgsReliefOverlay = tileLayerOffline(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
      {
        maxNativeZoom: 13, maxZoom: 19, minZoom: 3, opacity: 0.45,
        attribution: 'Shaded relief: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>, 3DEP',
      }
    )
    this.usgsReliefOverlay = usgsReliefOverlay
    usgsReliefOverlay.createTile = (coords: L.Coords, done: L.DoneCallback) => reliefTileWithFallback(usgsReliefOverlay, coords, done) as HTMLImageElement // it is really a div; v2 types createTile as HTMLImageElement

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
    const savedTilesOverlay = new L.GeoJSON(undefined, {
      style: { color: '#2266aa', weight: 1, fillOpacity: 0.15 },
    })
    this.savedTilesLayer = savedTilesOverlay  // E-138: shown by onBtnZoomToOfflineTiles(), not the menu
    return { tiles, openTopoTiles, usgsImageryTiles, usgsReliefOverlay, savedTilesOverlay }
  }

  /**
   * Creates the "Save this area" control for the default base layer and wires its estimate,
   * the base-layer switching and the control's placement under the map (initMainMap(), after
   * the layers control is built).
   */
  wire(
    openTopoTiles: ReturnType<typeof tileLayerOffline>,
    tiles: ReturnType<typeof tileLayerOffline>,
    usgsImageryTiles: ReturnType<typeof tileLayerOffline>,
    savedTilesOverlay: L.GeoJSON
  ): void {
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
    this.offlineTileLayers = [tiles, openTopoTiles, usgsImageryTiles]
    this.saveTilesControl = saveTilesControl
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
      // E-162: satellite is not a tileLayerOffline - leave the save control bound to the last
      // offline layer, but block it (and say why) until an offline base is picked again.
      this.satelliteBaseActive = !this.offlineTileLayers.includes(newBase)
      if (this.satelliteBaseActive) {
        this.refreshEstimatedAreaInfo?.()
        return
      }
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
  }

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
    if (this.satelliteBaseActive) {
      alert('Switch to OpenTopoMap to save for offline use - satellite imagery is online only.')
      return
    }
    if (this.osmBaseActive) {
      // Defense in depth - the button is already CSS-disabled (rt-savetiles-disabled) and
      // its text already explains why for this case; this only matters if a click somehow
      // still reaches here (e.g. a keyboard Enter on a focused-but-disabled control).
      alert('Switch to OpenTopoMap to save for offline use - OpenStreetMap\'s servers don\'t allow it.')
      return
    }
    // The USGS shaded relief, when on, is saved too and counts toward the cap.
    const needed = status.lengthToBeSaved + this.reliefSaveCount
    if (needed > LEAFLET_SAVE_TILE_CAP) {
      alert(
        `That area would need ${needed.toLocaleString()} tiles - above the `
        + `${LEAFLET_SAVE_TILE_CAP.toLocaleString()}-tile limit per save. Zoom in to a `
        + `smaller area, or save it in a few smaller pieces, and try again.`
      )
      return
    }
    const estimate = this.saveEstimateText || `${status.lengthToBeSaved.toLocaleString()} tiles`
    if (confirm(`Save this area for offline use (${estimate})?`)) {
      successCallback()
      void this.saveReliefTiles()
    }
  }

  /** The USGS shaded relief overlay (see initMainMap), saved alongside the base layer. */
  private usgsReliefOverlay?: ReturnType<typeof tileLayerOffline>
  /** The "Save this area" control, for the zoom levels the relief save copies. */
  private saveTilesControl?: ReturnType<typeof savetiles>
  /** How many relief tiles the next save adds (0 when the overlay is off), for the estimate and cap. */
  private reliefSaveCount = 0

  /** The relief zoom levels a save covers: the base layer's levels, capped at the relief's last (13). */
  private reliefSaveLevels(baseLevels: number[]): number[] {
    const relief = this.usgsReliefOverlay
    if (!relief || !this.lMap?.hasLayer(relief)) {
      return []
    }
    const top = relief.options.maxNativeZoom ?? 13
    return [...new Set(baseLevels.map(z => Math.min(z, top)))]
  }

  /**
   * 2026-10-01, John: saves the USGS shaded relief for the same area and zoom levels as the
   * base layer's save just started (leaflet.offline's save control saves one layer), when the
   * relief overlay is on. Tiles already saved are skipped; three at a time, like the base save;
   * a failed tile is skipped rather than stopping the rest.
   */
  private async saveReliefTiles(): Promise<void> {
    const relief = this.usgsReliefOverlay
    const levels = this.reliefSaveLevels((this.saveTilesControl?.options.zoomlevels as number[] | undefined) ?? [])
    if (!relief || !levels.length) {
      return
    }
    const url = (relief as unknown as { _url: string })._url
    const view = this.lMap.getBounds()
    const jobs = levels.flatMap(z => getTilePoints(
      new L.Bounds(this.lMap.project(view.getNorthWest(), z), this.lMap.project(view.getSouthEast(), z)), new L.Point(256, 256))
      .map(p => ({ x: p.x, y: p.y, z })))
    let saved = 0
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        // A tile missing from USGS's cache: save the nearest parent instead, the one
        // reliefTileWithFallback() will draw in its place (up to RELIEF_FALLBACK_LEVELS up).
        for (let up = 0; up <= RELIEF_FALLBACK_LEVELS && job.z - up >= 0; up++) {
          const t = { x: Math.floor(job.x / 2 ** up), y: Math.floor(job.y / 2 ** up), z: job.z - up }
          const key = getTileUrl(url, { ...relief.options, ...t })
          try {
            if (!(await hasTile(key))) {
              const blob = await downloadTile(key)
              await saveTile({ key, url: key, urlTemplate: url, ...t, createdAt: Date.now() }, blob)
              saved++
            }
            break
          } catch {
            // missing at this level (404) - try the parent
          }
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    this.log.info(`Saved ${saved} USGS shaded relief tiles.`, this.id)
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

    // 2026-09-30, John: the two status lines are notes UNDER the Save/Remove button pair (direct
    // children of the control, styled as muted full-width lines), no longer text inside the
    // buttons - the long reasons made the buttons huge. See the scss for .offline-area-info.
    const savedInfo = this.document.createElement('span')
    savedInfo.className = 'offline-area-info offline-area-info--saved'
    const estimateInfo = this.document.createElement('span')
    estimateInfo.className = 'offline-area-info offline-area-info--estimate'
    container.appendChild(estimateInfo)
    container.appendChild(savedInfo)

    this.refreshSavedAreaInfo = () => {
      getStorageInfo(urlTemplate).then((stored) => {
        if (stored.length === 0) {
          savedInfo.textContent = 'Saved on this device: nothing yet.'
          return
        }
        const bytes = stored.reduce((sum, t) => sum + (t.blob?.size ?? 0), 0)
        savedInfo.textContent = `Saved on this device: ${stored.length} tiles, about ${formatBytes(bytes)}.`
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
        // E-138: keep the "Zoom to offline tiles" button in step - disabled when nothing
        // is saved, and a shown overlay is taken down if the last tiles were just removed.
        this.hasOfflineTiles.set(stored.length > 0)
        if (stored.length === 0 && this.lMap.hasLayer(savedTilesOverlay)) {
          this.lMap.removeLayer(savedTilesOverlay)
          this.offlineTilesShown.set(false)
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
      const saveBlocked = this.osmBaseActive || this.satelliteBaseActive
      saveButton.classList.toggle('rt-savetiles-disabled', saveBlocked)
      saveButton.setAttribute('aria-disabled', String(saveBlocked))
      if (this.satelliteBaseActive) {
        estimateInfo.textContent = 'Esri satellite imagery can\'t be saved (its terms don\'t allow it). '
          + 'Switch to OpenTopoMap, or in the US to USGS aerial photos, to save for offline use.'
        this.saveEstimateText = ''
        return
      }
      if (this.osmBaseActive) {
        estimateInfo.textContent =
          'To save for offline use, switch to OpenTopoMap (OpenStreetMap does not allow bulk saving).'
        this.saveEstimateText = ''
        return
      }

      // P1-2: the active layer's own maxZoom (OpenTopoMap 17, OSM 19) - a hard-coded 19 used
      // to ask OpenTopoMap for levels past its own tile-generation limit and get nothing.
      // 2026-10-01: maxNativeZoom first - the USGS photos stop at 16 but enlarge to 19.
      const layerMaxZoom = activeTiles.options.maxNativeZoom ?? activeTiles.options.maxZoom ?? this.lMap.getZoom()
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
        const area = new L.Bounds(
          this.lMap.project(bounds.getNorthWest(), levelZoom),
          this.lMap.project(bounds.getSouthEast(), levelZoom)
        )
        return sum + getTilePoints(area, activeTiles.getTileSize()).length
      }, 0)
      // The USGS shaded relief, when it's on, is saved with the base layer (saveReliefTiles()).
      const reliefCount = this.reliefSaveLevels(zoomLevels).reduce((sum, levelZoom) => sum + getTilePoints(
        new L.Bounds(this.lMap.project(bounds.getNorthWest(), levelZoom), this.lMap.project(bounds.getSouthEast(), levelZoom)),
        new L.Point(256, 256)).length, 0)
      this.reliefSaveCount = reliefCount

      getStorageInfo(urlTemplate).then((stored) => {
        const avgBytes = stored.length > 0
          ? stored.reduce((sum, t) => sum + (t.blob?.size ?? 0), 0) / stored.length
          : FALLBACK_TILE_BYTES
        const total = tileCount + reliefCount
        this.saveEstimateText = `~${total} tiles (zoom ${zoomLevels[0]}–${zoomLevels[zoomLevels.length - 1]}`
          + `${reliefCount ? `, incl. ${reliefCount} shaded relief` : ''}), ~${formatBytes(total * avgBytes)}`
        estimateInfo.textContent = `This view: ${this.saveEstimateText}.`
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
   * Offline sharp print: whether every tile one zoom level deeper than the current view, over
   * the area the print shows (the map is already at its printed size), is saved on this device.
   * Keys are built the way leaflet.offline builds them (first subdomain, see its
   * TileLayerOffline), so a saved tile at zoom z+1 matches what the sharpened layer will ask for.
   */
  async deeperTilesSaved(layer: L.TileLayer): Promise<boolean> {
    const z = Math.round(this.lMap.getZoom()) + 1
    const native = layer.options.maxNativeZoom ?? layer.options.maxZoom ?? 18
    if (z > native) {
      return false
    }
    const view = this.lMap.getBounds()
    const area = new L.Bounds(this.lMap.project(view.getNorthWest(), z), this.lMap.project(view.getSouthEast(), z))
    const url = (layer as unknown as { _url: string })._url
    const subdomain = (layer.options.subdomains as string | string[] | undefined)?.[0]
    const keys = getTilePoints(area, layer.getTileSize())
      .map(p => getTileUrl(url, { ...layer.options, x: p.x, y: p.y, z, s: subdomain }))
    try {
      return (await Promise.all(keys.map(k => hasTile(k)))).every(Boolean)
    } catch {
      return false
    }
  }

  /**
   * 2026-09-30, John: E-138 - "Zoom to offline tiles". Shows the blue saved-area overlay and
   * fits the map to it; pressed again, hides it (the camera stays where it is, like the
   * layers-menu checkbox this replaces). Disabled in the template while nothing is saved,
   * and guarded here because L.GeoJSON.getBounds() throws on zero features.
   */
  onBtnZoomToOfflineTiles(): void {
    const layer = this.savedTilesLayer
    if (!layer || !this.lMap) {
      return
    }
    if (this.lMap.hasLayer(layer)) {
      this.lMap.removeLayer(layer)
      this.offlineTilesShown.set(false)
      return
    }
    if (layer.getLayers().length === 0) {
      return
    }
    layer.addTo(this.lMap)
    this.offlineTilesShown.set(true)
    // 2026-10-19, John (AAR): in the Montecito demo this flew to the Grand Canyon - the only
    // tiles saved on that phone were from an earlier demo, and nothing said so. Now it goes to
    // the saved area nearest the map, and says when that is somewhere else.
    const center = this.lMap.getCenter()
    const area = LeafletOfflineController.nearestSavedArea(layer, center)
    const here = this.lMap.getBounds().intersects(area)
    this.lMap.fitBounds(area, { padding: [24, 24] })
    if (!here) {
      const km = Math.round(center.distanceTo(area.getCenter()) / 1000)
      this.host.note(`Nothing saved here. Showing your nearest saved area, about ${km.toLocaleString()} km away.`)
    }
  }

  /**
   * The saved tiles grouped into areas (tiles that touch or overlap), and the one nearest
   * `from`. A device can hold several areas far apart, such as two demos and a real mission.
   */
  static nearestSavedArea(layer: L.FeatureGroup, from: L.LatLng): L.LatLngBounds {
    let areas: L.LatLngBounds[] = []
    layer.eachLayer(l => {
      const b = (l as L.Polygon).getBounds?.()
      if (b?.isValid()) {
        areas.push(new L.LatLngBounds(b.getSouthWest(), b.getNorthEast()))
      }
    })
    // Merge until no two areas touch; a few passes at most for the tile counts a phone holds.
    for (let merged = true; merged;) {
      merged = false
      const next: L.LatLngBounds[] = []
      for (const a of areas) {
        const hit = next.find(n => n.intersects(a))
        if (hit) {
          hit.extend(a)
          merged = true
        } else {
          next.push(a)
        }
      }
      areas = next
    }
    if (areas.length === 0) {
      return layer.getBounds()
    }
    return areas.reduce((best, a) => from.distanceTo(a.getCenter()) < from.distanceTo(best.getCenter()) ? a : best)
  }

  /** Removes the layer and map listeners (the component's ngOnDestroy). */
  dispose(): void {
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
  }
}
