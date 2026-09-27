import {
  DEMO_SCENARIO_STORAGE_KEY, activeDemoDetailMap, activeDemoScenario, clearActiveDemoScenario,
  isInsideBbox, pruneWarmCache, setActiveDemoScenario, wantedPmtilesUrls
} from './demo-map';
import { buildPmtilesStyle } from './map-style';
import { DEFAULT_PMTILES_URL, DEMO_DETAIL_MAPS, PMTILES_WARM_CACHE_NAME } from './pmtiles-config';

describe('demo-map (E-124)', () => {
  beforeEach(() => localStorage.removeItem(DEMO_SCENARIO_STORAGE_KEY));
  afterEach(async () => {
    localStorage.removeItem(DEMO_SCENARIO_STORAGE_KEY);
    await caches.delete(PMTILES_WARM_CACHE_NAME);
  });

  it('wants only the world base when no demo is loaded (a real mission)', () => {
    expect(activeDemoScenario()).toBeNull();
    expect(wantedPmtilesUrls()).toEqual([DEFAULT_PMTILES_URL]);
  });

  it('wants the loaded demo\'s detail file too', () => {
    setActiveDemoScenario('grand-canyon');
    expect(wantedPmtilesUrls()).toEqual([DEFAULT_PMTILES_URL, DEMO_DETAIL_MAPS['grand-canyon']!.url]);
  });

  it('wants no detail for near-me, and none while a custom map file is in use', () => {
    setActiveDemoScenario('near-me');
    expect(wantedPmtilesUrls()).toEqual([DEFAULT_PMTILES_URL]);
    setActiveDemoScenario('vashon');
    expect(activeDemoDetailMap({ customActive: true })).toBeUndefined();
    expect(wantedPmtilesUrls({ customActive: true })).toEqual([DEFAULT_PMTILES_URL]);
  });

  it('ignores an unknown stored value rather than trusting it', () => {
    localStorage.setItem(DEMO_SCENARIO_STORAGE_KEY, 'not-a-scenario');
    expect(activeDemoScenario()).toBeNull();
  });

  it('clearing the marker forgets the demo', () => {
    setActiveDemoScenario('state-fair');
    clearActiveDemoScenario();
    expect(activeDemoScenario()).toBeNull();
  });

  it('prune keeps wanted files and evicts everything else, including the pre-split archive', async () => {
    const cache = await caches.open(PMTILES_WARM_CACHE_NAME);
    const gc = DEMO_DETAIL_MAPS['grand-canyon']!.url;
    const vashon = DEMO_DETAIL_MAPS['vashon']!.url;
    for (const url of [DEFAULT_PMTILES_URL, gc, vashon, '/assets/maps/world-vashon.pmtiles']) {
      await cache.put(url, new Response('x'));
    }

    const deleted = await pruneWarmCache([DEFAULT_PMTILES_URL, gc]);

    expect(deleted).toBe(2);
    expect(await cache.match(DEFAULT_PMTILES_URL)).toBeTruthy();
    expect(await cache.match(gc)).toBeTruthy();
    expect(await cache.match(vashon)).toBeUndefined();
    expect(await cache.match('/assets/maps/world-vashon.pmtiles')).toBeUndefined();
  });

  it('isInsideBbox', () => {
    const bbox = DEMO_DETAIL_MAPS['grand-canyon']!.bbox;
    expect(isInsideBbox(-112.1, 36.06, bbox)).toBeTrue();
    expect(isInsideBbox(-122.46, 47.4, bbox)).toBeFalse();
  });
});

describe('buildPmtilesStyle (E-124)', () => {
  it('has only the basemap source without a detail file', () => {
    const style = buildPmtilesStyle(DEFAULT_PMTILES_URL);
    expect(Object.keys(style.sources)).toEqual(['basemap']);
    expect(style.layers.length).toBe(6);
  });

  it('adds a detail source, with its five data layers drawn after the base', () => {
    const detail = DEMO_DETAIL_MAPS['grand-canyon']!.url;
    const style = buildPmtilesStyle(DEFAULT_PMTILES_URL, detail);
    expect((style.sources['detail'] as { url: string }).url).toBe('pmtiles://' + detail);
    const ids = style.layers.map(l => l.id);
    expect(ids.slice(6)).toEqual(['detail-earth', 'detail-water', 'detail-landuse', 'detail-roads', 'detail-buildings']);
    expect(ids.indexOf('detail-earth')).toBeGreaterThan(ids.indexOf('buildings'));
  });
});
