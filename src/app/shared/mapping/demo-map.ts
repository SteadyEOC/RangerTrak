import type { SampleScenarioId } from '../services/sample-data.service'
import { DEFAULT_PMTILES_URL, DEMO_DETAIL_MAPS, DemoDetailMap, PMTILES_WARM_CACHE_NAME } from './pmtiles-config'

/**
 * E-124 (2026-09-26): which demo scenario, if any, is the loaded mission - the one thing that
 * decides whether a demo's street-detail map file may be fetched at all (payload rule: only
 * while that demo is loaded AND the Alternative map is open, never for a real mission).
 *
 * The mission id (`YYYY-MM-Search`) cannot tell a demo from a real mission, so this is its own
 * marker. A plain localStorage key, deliberately NOT a new MissionType field - new mission
 * fields have broken returning users twice (see mission-migration.ts). Not PII, so it does not
 * belong in the encrypted RecordStore either.
 *
 * Plain functions rather than a service: the encryption lock screen's "erase this device"
 * path (shared/storage/unlock-form.ts) runs before Angular boots and has no injector.
 */
export const DEMO_SCENARIO_STORAGE_KEY = 'rangertrak-demo-scenario'

// Kept local rather than read off sample-data.service.ts's SAMPLE_SCENARIOS: that would pull
// the whole sample-data module into the eager bundle via MissionReadinessService.
const KNOWN_SCENARIOS: readonly SampleScenarioId[] = ['vashon', 'grand-canyon', 'state-fair', 'near-me']

/**
 * E-168a (2026-10-01, John): the stored value is now JSON - the scenario plus what the loader
 * created, so "demo rows" can be told from real rows added later (E-168). The old value was the
 * bare scenario id; it still reads (as a record with empty lists). Still a plain localStorage
 * key for the same reasons as above, and the four clear paths are unchanged.
 */
export type DemoRecord = {
  scenario: SampleScenarioId,
  loadedAt: string,       // ISO time the demo was loaded
  rangerUids: string[],   // RangerType.uid of every roster row the loader created
  reportIds: string[],    // String(RadioLogEntryType.id) of every report the loader created
}

/** The parsed demo record, or null when no demo is loaded (or the value is unreadable). */
export function demoRecord(): DemoRecord | null {
  try {
    const raw = localStorage.getItem(DEMO_SCENARIO_STORAGE_KEY)
    if (!raw) return null
    // Old format: the bare scenario id.
    if (KNOWN_SCENARIOS.includes(raw as SampleScenarioId)) {
      return { scenario: raw as SampleScenarioId, loadedAt: '', rangerUids: [], reportIds: [] }
    }
    const parsed = JSON.parse(raw) as Partial<DemoRecord> | null
    if (!parsed || !KNOWN_SCENARIOS.includes(parsed.scenario as SampleScenarioId)) return null
    return {
      scenario: parsed.scenario as SampleScenarioId,
      loadedAt: typeof parsed.loadedAt === 'string' ? parsed.loadedAt : '',
      rangerUids: Array.isArray(parsed.rangerUids) ? parsed.rangerUids.map(String) : [],
      reportIds: Array.isArray(parsed.reportIds) ? parsed.reportIds.map(String) : [],
    }
  } catch {
    return null
  }
}

export function activeDemoScenario(): SampleScenarioId | null {
  return demoRecord()?.scenario ?? null
}

/** Set by SampleDataService.loadSampleMission(), for every scenario - including `near-me`,
 *  which has no detail file, so switching to it still evicts the previous demo's. */
export function setActiveDemoScenario(
  scenario: SampleScenarioId,
  created: { rangerUids?: string[], reportIds?: string[] } = {}
): void {
  const record: DemoRecord = {
    scenario, loadedAt: new Date().toISOString(),
    rangerUids: created.rangerUids ?? [], reportIds: created.reportIds ?? [],
  }
  try {
    localStorage.setItem(DEMO_SCENARIO_STORAGE_KEY, JSON.stringify(record))
  } catch { /* storage blocked: the demo just gets no street detail */ }
  pruneWarmCache(wantedPmtilesUrls()).catch(() => { /* best effort */ })
}

/** Called whenever the demo stops being the loaded mission (restore from backup, reset,
 *  erase). Evicts right away rather than waiting for the Alternative map to be opened again,
 *  which may never happen. Fire-and-forget: callers reload the page straight after. */
export function clearActiveDemoScenario(): void {
  try {
    localStorage.removeItem(DEMO_SCENARIO_STORAGE_KEY)
  } catch { /* nothing stored, nothing to clear */ }
  pruneWarmCache(wantedPmtilesUrls()).catch(() => { /* best effort */ })
}

/** The active demo's detail map, unless a scribe's own map file is in use - their file
 *  replaces the bundled base, and demo detail layered over someone else's map would only
 *  confuse. */
export function activeDemoDetailMap(options: { customActive?: boolean } = {}): DemoDetailMap | undefined {
  if (options.customActive) {
    return undefined
  }
  const scenario = activeDemoScenario()
  return scenario ? DEMO_DETAIL_MAPS[scenario] : undefined
}

/** Every map file this device should hold in the warm cache right now: the world base, plus
 *  the loaded demo's detail file if there is one. */
export function wantedPmtilesUrls(options: { customActive?: boolean } = {}): string[] {
  const detail = activeDemoDetailMap(options)
  return detail ? [DEFAULT_PMTILES_URL, detail.url] : [DEFAULT_PMTILES_URL]
}

/**
 * Deletes every warm-cache entry that is not in `wanted` - a replaced demo's detail file, and
 * any file from an older build (the pre-split `world-vashon.pmtiles` among them). Cache keys
 * come back as absolute URLs, so both sides are compared resolved. Returns how many it
 * deleted.
 */
export async function pruneWarmCache(wanted: string[]): Promise<number> {
  if (typeof caches === 'undefined') {
    return 0
  }
  const keep = new Set(wanted.map(u => new URL(u, location.href).href))
  const cache = await caches.open(PMTILES_WARM_CACHE_NAME)
  let deleted = 0
  for (const request of await cache.keys()) {
    if (!keep.has(new URL(request.url, location.href).href) && await cache.delete(request)) {
      deleted++
    }
  }
  return deleted
}

/** True when the view centre is inside `bbox`. */
export function isInsideBbox(lng: number, lat: number, bbox: DemoDetailMap['bbox']): boolean {
  const [west, south, east, north] = bbox
  return lng >= west && lng <= east && lat >= south && lat <= north
}
