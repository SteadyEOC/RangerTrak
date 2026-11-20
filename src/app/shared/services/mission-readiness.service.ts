import { Injectable, computed, inject, signal } from '@angular/core'

import { wantedPmtilesUrls } from '../mapping/demo-map'
import { CustomPmtilesService } from './custom-pmtiles.service'
import { MapEngineService } from '../../map-core/map-engine.service'
import { ViewService } from './view.service'
import { DevicePrefsService } from './device-prefs.service'
import { LogService } from './log.service'
import { RangerService } from './ranger.service'
import { MissionService } from './mission.service'
import { StoragePersistenceService } from './storage-persistence.service'

export type ReadinessLevel = 'red' | 'amber' | 'green'

/**
 * E-299 (John 11-14): the readiness items a person may ignore, because they may not apply or can't be fixed on
 * this device (a browser that never grants persistent storage, a laptop that will never use the backup map). An
 * ignored item stops pulling the level down but stays listed, marked ignored. The two red items (mission named,
 * real roster) and the op period are never ignorable: they are always fixable and always matter.
 */
export type IgnorableReadiness = 'offlineTiles' | 'mapWarmed' | 'storage' | 'winlink'
export const IGNORABLE_READINESS: readonly IgnorableReadiness[] = ['offlineTiles', 'mapWarmed', 'storage', 'winlink']

/** sessionStorage: JSON array of IgnorableReadiness ids. This tab only; gone when it closes (John: "for this session"). */
export const READINESS_IGNORED_KEY = 'rt-readiness-ignored'

/** Reads the stored ignore list defensively: anything unknown or malformed is dropped. */
export function parseIgnored(raw: string | null): Set<IgnorableReadiness> {
  if (!raw) return new Set()
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return new Set()
    return new Set(v.filter((x): x is IgnorableReadiness => IGNORABLE_READINESS.includes(x as IgnorableReadiness)))
  } catch {
    return new Set()
  }
}

/**
 * ADR D-32: a persistent readiness indicator reporting whether *this device* is actually
 * prepared for an unattended, offline mission - not whether the app is technically usable.
 * All six signals were already measurable with nothing new to persist; this is the service
 * that surfaces them. Never reads as "you cannot work" - a scribe can always log a report
 * regardless of state.
 *
 * Two signals are synchronous (mission named, roster loaded - both driven off subscriptions
 * this service already holds). Three are async (offline map tiles saved, the bundled
 * MapLibre asset warmed, storage-eviction protection granted) and only refreshed on
 * `refresh()` - called by MissionReadinessComponent's ngOnInit, which runs fresh on every
 * page since HeaderComponent (and therefore this component) is instantiated per page by
 * PageComponent.
 *
 * **Level formula (a judgment call, not specified elsewhere - documented here so it can be
 * revisited deliberately rather than rediscovered by reading the code):**
 * - **red** - mission not named, or roster still the untouched hardcoded sample. Nothing
 *   resembling real setup has happened yet.
 * - **amber** - basic setup is done (mission + real roster) but a resilience gap remains:
 *   the operating period has expired, or any of the three offline-prep signals is missing.
 *   The app works fine online; a real network loss would expose the gap.
 * - **green** - all six signals pass. Prepared for the worst case (total network loss).
 *
 * The "Alternative map warmed" signal counts only where the alternative map is offered:
 * Easy menus hides MapLibre unless it is the engine in use, so there the signal is left out
 * of the level and of the readiness lists (`mapWarmedCounts`), instead of pointing at a
 * switch the person cannot see.
 */
@Injectable({ providedIn: 'root' })
export class MissionReadinessService {
  private id = 'Mission Readiness Service'

  readonly missionNamed = signal(false)
  readonly opPeriodCurrent = signal(false)
  readonly rosterLoaded = signal(false)
  readonly offlineTilesSaved = signal(false)
  readonly bundledMapWarmed = signal(false)
  readonly storagePersisted = signal(false)
  /**
   * E-307 (Q81): a Winlink call sign is set (this mission's, else this device's). Advisory only: it is listed in
   * Full menus but never moves the level, since most missions never send by radio.
   */
  readonly winlinkCallSet = signal(false)
  private missionWinlinkCall = ''

  private readonly view = inject(ViewService)
  private readonly mapEngine = inject(MapEngineService)
  private readonly devicePrefs = inject(DevicePrefsService)

  /** The advisory shows only where Send by radio does (Full menus). */
  readonly winlinkAdvisoryCounts = computed(() => this.view.isShown('send-by-radio'))

  /** False in Easy menus unless MapLibre is the engine in use (see the class comment). */
  readonly mapWarmedCounts = computed(() =>
    this.view.isShown('maplibre', { mapEngineIsAlternative: this.mapEngine.engine() === 'maplibre' }))

  /** E-299: the items ignored in this tab. */
  readonly ignored = signal<ReadonlySet<IgnorableReadiness>>(this.loadIgnored())

  isIgnored(id: IgnorableReadiness): boolean {
    return this.ignored().has(id)
  }

  ignore(id: IgnorableReadiness): void {
    this.setIgnored(new Set([...this.ignored(), id]))
  }

  unignore(id: IgnorableReadiness): void {
    const next = new Set(this.ignored())
    next.delete(id)
    this.setIgnored(next)
  }

  private loadIgnored(): Set<IgnorableReadiness> {
    try { return parseIgnored(sessionStorage.getItem(READINESS_IGNORED_KEY)) } catch { return new Set() }
  }

  private setIgnored(next: Set<IgnorableReadiness>): void {
    this.ignored.set(next)
    try {
      if (next.size) sessionStorage.setItem(READINESS_IGNORED_KEY, JSON.stringify([...next]))
      else sessionStorage.removeItem(READINESS_IGNORED_KEY)
    } catch { /* private mode or a read-only window: the ignore still holds until reload */ }
  }

  readonly level = computed<ReadinessLevel>(() => {
    if (!this.missionNamed() || !this.rosterLoaded()) {
      return 'red'
    }
    const ign = this.ignored()
    if (
      !this.opPeriodCurrent() ||
      (!this.offlineTilesSaved() && !ign.has('offlineTiles')) ||
      (this.mapWarmedCounts() && !this.bundledMapWarmed() && !ign.has('mapWarmed')) ||
      (!this.storagePersisted() && !ign.has('storage'))
    ) {
      return 'amber'
    }
    return 'green'
  })

  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private storagePersistenceService: StoragePersistenceService,
    private customPmtiles: CustomPmtilesService,
    private log: LogService,
  ) {
    this.missionService.getMissionObserver().subscribe({
      next: settings => {
        this.missionNamed.set(settings.mission.trim() !== '')
        this.opPeriodCurrent.set(new Date(settings.opPeriodEnd).getTime() > Date.now())
        this.missionWinlinkCall = (settings.winlinkCall ?? '').trim()
        this.refreshWinlink()
      },
      error: e => this.log.error(`Settings subscription error: ${e}`, this.id),
    })

    this.rangerService.getRangersObserver().subscribe({
      next: rangers => this.rosterLoaded.set(RangerService.isRealRosterLoaded(rangers)),
      error: e => this.log.error(`Rangers subscription error: ${e}`, this.id),
    })
  }

  /** The call sign can be set from the Send by radio dialog at any time, so this reads the device again. */
  refreshWinlink(): void {
    this.winlinkCallSet.set(!!this.missionWinlinkCall || !!this.devicePrefs.getWinlinkCall())
  }

  /** Re-checks the three async signals. Safe to call repeatedly; each check is read-only. */
  async refresh(): Promise<void> {
    this.refreshWinlink()
    this.storagePersisted.set(this.storagePersistenceService.persisted() === true)

    try {
      const tileCount = await this.countOfflineTiles()
      this.offlineTilesSaved.set(tileCount > 0)
    } catch (e) {
      this.log.warn(`countOfflineTiles() failed: ${e}`, this.id)
      this.offlineTilesSaved.set(false)
    }

    // E-124: "warmed" means EVERY map file this device should hold - the world base, plus
    // the loaded demo's street-detail file when a demo is the mission - not just the base.
    try {
      const wanted = wantedPmtilesUrls({ customActive: !!this.customPmtiles.active() })
      const matches = await Promise.all(wanted.map(url => caches.match(url)))
      this.bundledMapWarmed.set(matches.every(m => !!m))
    } catch (e) {
      this.log.warn(`caches.match() failed: ${e}`, this.id)
      this.bundledMapWarmed.set(false)
    }
  }

  /**
   * Counts saved offline map tiles without importing leaflet.offline at all.
   *
   * Found live on rangertrak.org (2026-08-20, from a real user's Log page export) after
   * this originally called leaflet.offline's own `getStorageLength()` via a dynamic
   * `import()` - chosen specifically to keep the ~160KB package out of the eager bundle
   * (see git history). That import broke silently in production: esbuild splits a
   * dynamically-imported CJS dependency into its own chunk whose only real ESM exports are
   * internal interop helpers, not the package's named exports - `const { getStorageLength
   * } = await import(...)` destructured `undefined`, and every call threw "is not a
   * function". Reproduced locally the same way once actually tested across several page
   * navigations rather than a single page load (which happened to dodge it) - see
   * [[verify-the-measurement-itself]].
   *
   * `getStorageLength()`'s own implementation (leaflet.offline's TileManager.ts) is just an
   * IndexedDB count - `openDB('leaflet.offline', 2, {...}).count('tileStore')` - simple
   * enough to do directly with the raw IndexedDB API, sidestepping the bundler issue
   * entirely rather than working around it.
   *
   * Safety constraint that shapes this whole method: `LmapComponent`/`MiniMapLeafletComponent`
   * elsewhere in the app open this exact database via leaflet.offline's own `openDB`,
   * which creates the `tileStore` object store the FIRST time the database is opened at
   * all (an `onupgradeneeded` with `oldVersion < 1`). If this method opened the database
   * first - before a user ever visited a map page - it would create an empty schema at
   * version 1 with no upgrade logic of its own, and leaflet.offline's later `openDB(...,
   * 2, ...)` would then see `oldVersion` as 1, not 0, and skip creating `tileStore`
   * entirely - silently breaking the real offline-tile-saving feature for anyone whose
   * first interaction with this database happened to be the readiness check. So this only
   * ever opens the database after confirming (via `indexedDB.databases()`) that it already
   * exists, and never supplies a version or an upgrade handler.
   */
  private async countOfflineTiles(): Promise<number> {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
      return 0
    }
    const existing = await indexedDB.databases()
    if (!existing.some(d => d.name === 'leaflet.offline')) {
      return 0
    }

    return new Promise<number>(resolve => {
      const openRequest = indexedDB.open('leaflet.offline')
      openRequest.onerror = () => resolve(0)
      openRequest.onsuccess = () => {
        const db = openRequest.result
        if (!db.objectStoreNames.contains('tileStore')) {
          db.close()
          resolve(0)
          return
        }
        const countRequest = db.transaction('tileStore', 'readonly').objectStore('tileStore').count()
        countRequest.onsuccess = () => { resolve(countRequest.result); db.close() }
        countRequest.onerror = () => { resolve(0); db.close() }
      }
    })
  }
}
