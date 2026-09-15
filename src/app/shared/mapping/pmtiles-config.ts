// Split out of map-style.ts so this one constant can be imported without dragging in
// maplibre-gl (~800KB, imported eagerly at that file's top for addProtocol/setWorkerUrl).
// MissionReadinessService (D-32) needs this path but must stay light - it's root-provided
// and rendered via HeaderComponent on every page, including the eager Entry page, so
// importing map-style.ts here would undo E-64's work keeping MapLibre out of the initial
// bundle.
//
// NOTE: this is a normal static asset under /assets/**, which ngsw-config.json caches with
// installMode "lazy" - so it is cached on FIRST REQUEST, not at install time. The offline
// map therefore only works offline after the /map page has been opened once while
// connected. See FIELD-GUIDE.md ("Warm start").
//
// 2026-09-14 (offline map coverage scoping, Q6 YES): was `vashon.pmtiles`, the Vashon-only
// pilot extract (1.7 MB, z0-15, one small bbox - blank background anywhere else in the
// world). Replaced with `world-vashon.pmtiles`, a merged archive built with the `pmtiles`
// CLI: a z0-5 world background (`pmtiles extract <planet> --minzoom=0 --maxzoom=5`, ~15 MB)
// plus the original Vashon extract's own z6-15 detail (`pmtiles extract vashon.pmtiles
// --minzoom=6 --maxzoom=15`, ~1.3 MB - the two are disjoint by ZOOM LEVEL, which is what
// `pmtiles merge` requires of its inputs), so a tester anywhere in the world gets a real
// low-detail basemap instead of gray, and Vashon itself keeps its original street-level
// detail. Verified with `pmtiles verify` after merging. See the scoping doc's "Phase 1
// implementation" section for the exact commands.
//
// OfflineBasemapService (shared/services/offline-basemap.service.ts) keys its Cache Storage
// entry on this exact URL string - Cache Storage matches by URL, not by file content, so
// replacing this file again in the future (a newer planet build, wider background coverage,
// ...) needs a NEW filename or a `?v=N` query bump here, or every device that already warmed
// the old one will keep serving it from cache indefinitely instead of ever re-fetching.
export const DEFAULT_PMTILES_URL = '/assets/maps/world-vashon.pmtiles'
