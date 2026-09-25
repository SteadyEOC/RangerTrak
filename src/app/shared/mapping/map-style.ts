import { addProtocol, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import { FileSource, PMTiles, Protocol, ResolvedValueCache } from 'pmtiles'

import { CacheFirstSource } from './cache-first-source'
import { DEFAULT_PMTILES_URL, PMTILES_WARM_CACHE_NAME } from './pmtiles-config'

export { DEFAULT_PMTILES_URL }

/**
 * Where the MapLibre worker bundle is served from. maplibre-gl v6 splits its worker into
 * a separate ES module (plus a large shared chunk it imports by relative path), rather
 * than inlining it as v5 and earlier did.
 *
 * By default v6 derives the worker URL from its own module URL, which after Angular's
 * esbuild bundling resolves to `/maplibre-gl-worker.mjs` at the site root - a file no
 * build step ever emits. The request then hit the dev-preview server's SPA fallback and
 * came back as index.html with `Content-Type: text/html`, so the worker was constructed
 * from HTML and died on the spot.
 *
 * That failure is completely silent: MapLibre fires no error event, the map still paints
 * background layers on the main thread, and the map simply shows blank forever - because
 * both vector tiles AND GeoJSON sources are parsed in the worker. Pointing MapLibre at a
 * copy we actually ship (see angular.json's assets entry, which copies the worker and its
 * shared chunk side by side so the worker's relative import resolves) is the fix.
 */
const MAPLIBRE_WORKER_URL = 'assets/maplibre/maplibre-gl-worker.mjs'

let maplibreInitialized = false
// Module-scoped, not local to registerPmtilesProtocol() below: registerCustomPmtilesSource()
// needs to add() to the SAME Protocol instance MapLibre was pointed at, not a second one -
// two Protocol instances would each keep their own `tiles` map, and only the one actually
// wired via addProtocol() ever gets asked to resolve a `pmtiles://` URL.
let pmtilesProtocol: Protocol | undefined

/**
 * One-time global MapLibre setup: points it at the worker bundle we ship, and registers
 * the `pmtiles://` protocol handler. Idempotent - safe to call from every map
 * component's constructor, which is exactly how it is used.
 *
 * ROOT-CAUSED 2026-09-01 (read pmtiles@4.5.0's own source, not the minified bundle
 * guessed at): `Protocol`'s default `PMTiles` instance uses `SharedPromiseCache`, whose
 * `getDirectory()` never evicts its cache entry when the underlying fetch rejects - only
 * a later `AbortController` listener does, and only for the specific ref that triggered
 * the abort. A directory fetch that rejects any other way (a Range request answered `200`
 * instead of `206`, a bad ETag, a non-2xx status) leaves a permanently-rejected promise
 * cached under that byte range, so every later tile needing the SAME leaf directory
 * rejects instantly with no network request at all - which is what a live CDP probe this
 * same day showed (55 fetches, 7 aborted, 0 ever re-fetched, always a contiguous
 * rectangular strip of tiles). Combined with maplibre-gl's own `TileManager._loadTile`
 * (dist/maplibre-gl-dev.mjs), which has no `AbortError` special case and parks ANY
 * rejected tile in `state: "errored"` forever, one poisoned directory entry reads as a
 * permanently gray region of the map.
 *
 * Pre-registering the bundled archive here with `ResolvedValueCache` instead - "a cache
 * ... where promises are never shared between requests" per pmtiles' own doc comment -
 * sidesteps the poisoning entirely: a failed fetch is never cached as pending, so the
 * next tile that needs it just tries again. Trade-off, real but small: unlike
 * `SharedPromiseCache`, concurrent tiles needing the same still-loading directory don't
 * share the in-flight request, so a cold map can issue a few duplicate header/directory
 * fetches. Cheap (tens of KB) next to a permanently blank strip of the map. See the
 * roadmap's Sept 1 (Opus) session write-up and its Sonnet handoff doc for the full
 * source trail; `map.refreshTiles()` (mapLibre.component.ts) is the other half of this
 * fix - a bounded retry for whatever this doesn't catch.
 *
 * The registration key must be the SAME string `buildPmtilesStyle()` embeds in
 * `pmtiles://<url>` below (`DEFAULT_PMTILES_URL`, unresolved) - `Protocol.add()` keys on
 * `source.getKey()`, which for `FetchSource` is the exact URL string passed to its
 * constructor, and `Protocol.tile()` recovers that same string by slicing the style's
 * `pmtiles://` URL apart. Resolving it to an absolute URL first would silently register
 * a second, default-cached PMTiles instance instead of replacing this one.
 */
export function registerPmtilesProtocol(): void {
  if (maplibreInitialized) {
    return
  }
  setWorkerUrl(MAPLIBRE_WORKER_URL)
  pmtilesProtocol = new Protocol()
  // CacheFirstSource, not a plain FetchSource (2026-09-25): reads the copy
  // OfflineBasemapService warmed into Cache Storage when there is one, which is what makes
  // this map work offline at all - see that class's own comment. Its getKey() is still the
  // unresolved DEFAULT_PMTILES_URL, per the key-matching note above.
  pmtilesProtocol.add(new PMTiles(new CacheFirstSource(DEFAULT_PMTILES_URL, PMTILES_WARM_CACHE_NAME), new ResolvedValueCache()))
  addProtocol('pmtiles', pmtilesProtocol.tile)
  maplibreInitialized = true
}

/**
 * Registers a scribe-supplied `.pmtiles` File as a usable `pmtiles://` source, for
 * CustomPmtilesService (shared/services/custom-pmtiles.service.ts) - the "let a scribe
 * supply their own .pmtiles file" half of the offline-coverage backlog item, since PMTiles'
 * one-archive-per-region shape has no per-tile "save what I'm looking at" equivalent to
 * Leaflet's `leaflet.offline`.
 *
 * `pmtiles-js`'s `FileSource` reads directly from the browser `File` object via
 * `file.slice()` - no fetch, no service worker, no network involved at all, which is exactly
 * what makes this buildable without any of the bundled-tileset's own coverage/regeneration
 * problems. `Protocol.add()` keys the registration on `source.getKey()`, which for a
 * `FileSource` is the file's own `name` - callers pass that same name back into
 * `buildPmtilesStyle()` as its `pmtilesUrl` argument so `pmtiles://<name>` resolves here
 * instead of attempting an HTTP fetch.
 *
 * Must be called after `registerPmtilesProtocol()` has run at least once (any map
 * component's constructor already guarantees this before building a style).
 */
export function registerCustomPmtilesSource(file: File): string {
  if (!pmtilesProtocol) {
    registerPmtilesProtocol()
  }
  // Same ResolvedValueCache reasoning as registerPmtilesProtocol()'s own bundled-archive
  // registration above - a scribe's own custom coverage deserves the same non-poisoning
  // cache, not just the bundled default.
  pmtilesProtocol!.add(new PMTiles(new FileSource(file), new ResolvedValueCache()))
  return file.name
}

/**
 * Builds a MapLibre style pointed at the bundled PMTiles basemap. No text-label glyphs
 * in v1 (see PRIVATE-Roadmap.md) - earth/water/roads/buildings/landuse render with
 * color/shape distinction only.
 *
 * `earth` (the landmass polygon) is drawn first among the data layers, directly on top
 * of the `bg` background layer and below everything else - without it, land is never
 * filled and reads as the same grey as the background, which made a working map look
 * "blank" even though tiles were loading and other layers were rendering correctly.
 */
export function buildPmtilesStyle(pmtilesUrl: string = DEFAULT_PMTILES_URL): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'vector',
        url: 'pmtiles://' + pmtilesUrl,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e0e0e0' } },
      { id: 'earth', type: 'fill', source: 'basemap', 'source-layer': 'earth', paint: { 'fill-color': '#f2e9d8' } },
      { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': '#8ec6ec' } },
      { id: 'landuse', type: 'fill', source: 'basemap', 'source-layer': 'landuse', paint: { 'fill-color': '#c8e6c0' } },
      { id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'roads', paint: { 'line-color': '#888', 'line-width': 1 } },
      { id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings', paint: { 'fill-color': '#c0a080' } }
    ]
  }
}
