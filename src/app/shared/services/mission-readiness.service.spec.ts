import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { MissionReadinessService } from './mission-readiness.service';
// E-122 Phase 2a: this service's constructor transitively constructs RangerService et al.,
// whose keys now live behind RecordStore rather than localStorage - reset for isolation, same
// as those services' own specs. This suite overrides every signal directly, so the roster
// content itself never matters, but the FRESH construction (a stray roster from a previous
// spec's own resetForTests()-less run) shouldn't leak in either.
import { recordStore } from '../storage/record-store';

/**
 * The six underlying signals are exercised by their own services (MissionService,
 * RangerService, StoragePersistenceService) and RangerService.isRealRosterLoaded's own
 * spec. These tests target the level() formula itself - the judgment call documented in
 * the service's own doc comment - by driving the (deliberately public, settable) signals
 * directly, independent of whatever the real subscriptions happened to populate them with.
 */
describe('MissionReadinessService', () => {
  let service: MissionReadinessService;

  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(MissionReadinessService);
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  function setAll(ready: boolean) {
    service.missionNamed.set(ready);
    service.rosterLoaded.set(ready);
    service.opPeriodCurrent.set(ready);
    service.offlineTilesSaved.set(ready);
    service.bundledMapWarmed.set(ready);
    service.storagePersisted.set(ready);
  }

  it('is green only when all six signals pass', () => {
    setAll(true);
    expect(service.level()).toBe('green');
  });

  it('is red when the mission is not named, even if everything else is ready', () => {
    setAll(true);
    service.missionNamed.set(false);
    expect(service.level()).toBe('red');
  });

  it('is red when the roster is not loaded, even if everything else is ready', () => {
    setAll(true);
    service.rosterLoaded.set(false);
    expect(service.level()).toBe('red');
  });

  it('is amber when basic setup is done but the operating period has expired', () => {
    setAll(true);
    service.opPeriodCurrent.set(false);
    expect(service.level()).toBe('amber');
  });

  it('is amber when basic setup is done but offline tiles were never saved', () => {
    setAll(true);
    service.offlineTilesSaved.set(false);
    expect(service.level()).toBe('amber');
  });

  it('is amber when basic setup is done but the bundled map was never warmed', () => {
    setAll(true);
    service.bundledMapWarmed.set(false);
    expect(service.level()).toBe('amber');
  });

  it('is amber when basic setup is done but storage is not protected from eviction', () => {
    setAll(true);
    service.storagePersisted.set(false);
    expect(service.level()).toBe('amber');
  });

  it('is red, not amber, when mission/roster are missing even alongside other gaps', () => {
    setAll(false);
    expect(service.level()).toBe('red');
  });

  // Found live on rangertrak.org: this originally called leaflet.offline's own
  // getStorageLength() via a dynamic import(), which broke silently in production -
  // esbuild splits a dynamically-imported CJS dependency into a chunk whose real ESM
  // exports are internal interop helpers, not the package's named exports, so the
  // destructured getStorageLength was undefined and every call threw. Reimplemented with
  // raw IndexedDB, matching leaflet.offline's own schema (TileManager.ts: db name
  // 'leaflet.offline', store 'tileStore') so it reads what the real library writes.
  //
  // Deliberately does NOT test the "database doesn't exist yet" / "doesn't create it"
  // safety properties here, and deliberately never deletes the 'leaflet.offline' database:
  // Karma runs every spec file in one shared browser tab, and mapLeaflet.component.spec.ts /
  // mini-mapLeaflet.component.spec.ts construct real Leaflet maps with real leaflet.offline
  // connections that are never explicitly closed (openTilesDataBase() caches its
  // connection for the app's lifetime, by design). `indexedDB.deleteDatabase(...)` blocks
  // until every open connection closes, so calling it here hung the whole suite whenever
  // an mapLeaflet-family spec had already run in the same session - confirmed by removing it and
  // watching the timeout disappear. The safety reasoning itself (never open before
  // confirming existence, never supply a version) is documented on countOfflineTiles()'s
  // own doc comment instead, verified by reading leaflet.offline's real source rather than
  // by a test that can't run reliably in this shared environment. Live-verified directly
  // against the served production build instead (both the "no database yet" and "tiles
  // exist" paths, each in a fresh browser profile).
  describe('countOfflineTiles (via refresh())', () => {
    it('is true once tiles exist, using the exact schema leaflet.offline itself writes', async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('leaflet.offline', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          const store = db.createObjectStore('tileStore', { keyPath: 'key' });
          store.createIndex('urlTemplate', 'urlTemplate');
          store.createIndex('z', 'z');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('tileStore', 'readwrite');
          tx.objectStore('tileStore').put({ key: 'a', url: 'x', urlTemplate: 'x', x: 1, y: 1, z: 15, createdAt: Date.now() });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });

      await service.refresh();
      expect(service.offlineTilesSaved()).toBe(true);
    });
  });
});
