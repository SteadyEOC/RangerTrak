// Split out of map-style.ts so these constants can be imported without dragging in
// maplibre-gl (~800KB, imported eagerly at that file's top for addProtocol/setWorkerUrl).
// MissionReadinessService (D-32) needs them but must stay light - it's root-provided and
// rendered via HeaderComponent on every page, including the eager Entry page, so importing
// map-style.ts here would undo E-64's work keeping MapLibre out of the initial bundle.
//
// NOTE: these are normal static assets under /assets/maps/**, which ngsw-config.json
// deliberately EXCLUDES (ngsw answers Range requests wrongly - see mapLibre.component.ts's
// warmBundledPmtilesCache() comment). OfflineBasemapService warms them into its own Cache
// Storage entry instead, from the /map page only. See FIELD-GUIDE.md ("Warm start").

import type { SampleScenarioId } from '../services/sample-data.service'

// E-124 split (2026-09-26): was one merged `world-vashon.pmtiles` (z0-5 world + Vashon's
// z6-15 detail, 16.3 MB) that every device opening the Alternative map downloaded, whichever
// demo - or real mission - it ran. Now a world-only base plus one small detail file per demo
// scenario, fetched only while that demo is the loaded mission AND the Alternative map is
// open. All four are cut by tools/build-demo-maps.sh from one Protomaps build.
//
// The build date is in every filename on purpose: OfflineBasemapService and CacheFirstSource
// key Cache Storage on the URL string, not the content, so a file replaced under the same name
// would keep being served from every device that already warmed it. A new build means new
// filenames here; OfflineBasemapService's prune step then evicts the old entries.
export const DEFAULT_PMTILES_URL = '/assets/maps/world-z5-20260926.pmtiles'

/** A demo scenario's own street-level (z6-15) detail archive, and its coverage box. */
export type DemoDetailMap = { url: string, bbox: [west: number, south: number, east: number, north: number] }

/** Boxes match tools/build-demo-maps.sh's DEMOS table exactly. `near-me` has none - it is
 *  wherever the device happens to be. */
export const DEMO_DETAIL_MAPS: Partial<Record<SampleScenarioId, DemoDetailMap>> = {
  'grand-canyon': { url: '/assets/maps/demo-grand-canyon-20260926.pmtiles', bbox: [-112.20, 36.03, -112.07, 36.12] },
  'vashon': { url: '/assets/maps/demo-vashon-20260926.pmtiles', bbox: [-122.53, 47.32, -122.40, 47.51] },
  'state-fair': { url: '/assets/maps/demo-state-fair-20260930.pmtiles', bbox: [-77.428, 37.842, -77.411, 37.854] },
}

/**
 * The Cache Storage cache OfflineBasemapService warms the map files into, and that
 * CacheFirstSource (cache-first-source.ts) reads them from when they are there. One constant
 * so the writer and the reader cannot drift apart - until 2026-09-25 only the writer (and the
 * readiness check) knew this cache existed, and the map went blank offline.
 */
export const PMTILES_WARM_CACHE_NAME = 'rangertrak-pmtiles-warm'
