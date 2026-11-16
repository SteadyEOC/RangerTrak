import { Injectable, Injector, OnDestroy, inject, signal } from '@angular/core'

import { listenForWrites } from '../storage/data-channel'
import { isReadOnlyWindow } from '../storage/read-only-window'
import { recordStore } from '../storage/record-store'
import { isMainWindowOpen } from '../storage/tab-lock'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { LayerService } from './layer.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'

/** How long a burst of announcements for one key is allowed to settle before it is re-read. */
export const POPOUT_DEBOUNCE_MS = 250
/** How often a pop-out checks that the main window is still there. */
export const MAIN_CHECK_MS = 5000

/**
 * E-313 / ADR D-71: how a read-only window (a pop-out) keeps up with the main window by itself.
 *
 * - The main window announces each key it has flushed on a BroadcastChannel (storage/data-channel.ts:
 *   the key name only). Here, each announced key is re-read, read-only, by RecordStore and handed to the
 *   service that owns it, which republishes; the Map, the grids and Summary already follow those
 *   observables and signals. A burst of announcements for one key is read once (250 ms).
 * - The mission settings live in localStorage, so the browser's own `storage` event tells us.
 * - A pop-out does not hold the tab lock, so `navigator.locks.query()` says whether the main window is
 *   still open (every 5 seconds and when the window is shown again). Closed: the window keeps showing the
 *   last data and says so (`mainWindowOpen`); back: it re-reads everything once, because it may have
 *   missed announcements while nobody was there to send them.
 *
 * Does nothing outside a read-only window. Never writes.
 */
@Injectable({ providedIn: 'root' })
export class PopOutSyncService implements OnDestroy {
  /** False while no main RangerTrak window is open: this window is showing what it last saw. */
  readonly mainWindowOpen = signal(true)

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private stops: Array<() => void> = []
  private started = false

  private readonly injector = inject(Injector)

  /** Begins listening. Safe to call more than once. */
  start(): void {
    if (this.started || !isReadOnlyWindow()) return
    this.started = true
    this.stops.push(listenForWrites(key => this.schedule(key)))

    const onStorage = (e: StorageEvent) => { if (e.key === 'appSettings' || e.key === null) this.schedule('appSettings') }
    window.addEventListener('storage', onStorage)
    this.stops.push(() => window.removeEventListener('storage', onStorage))

    const onVisible = () => { if (document.visibilityState === 'visible') void this.checkMainWindow() }
    document.addEventListener('visibilitychange', onVisible)
    this.stops.push(() => document.removeEventListener('visibilitychange', onVisible))

    const timer = setInterval(() => void this.checkMainWindow(), MAIN_CHECK_MS)
    this.stops.push(() => clearInterval(timer))
    void this.checkMainWindow()
  }

  ngOnDestroy(): void {
    this.stops.forEach(stop => stop())
    this.stops = []
    this.timers.forEach(t => clearTimeout(t))
    this.timers.clear()
    this.started = false
  }

  /** Debounce per key, then re-read. */
  private schedule(key: string): void {
    clearTimeout(this.timers.get(key))
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key)
      void this.refresh(key)
    }, POPOUT_DEBOUNCE_MS))
  }

  /** Re-reads one key and tells its service. Exposed for the unit tests. */
  async refresh(key: string): Promise<void> {
    if (key === 'appSettings') {
      this.injector.get(MissionService).reloadFromStore()
      return
    }
    if (!await recordStore.reloadKey(key)) return
    switch (key) {
      case 'rangers': this.injector.get(RangerService).reloadFromStore(); break
      case 'radioLog': this.injector.get(RadioLogService).reloadFromStore(); break
      case 'locations': this.injector.get(MissionLocationService).reloadFromStore(); break
      case 'aarNotes': this.injector.get(AarNoteService).reloadFromStore(); break
      case 'activityLogHeader': this.injector.get(ActivityLogHeaderService).reloadFromStore(); break
      case 'missionJournal': this.injector.get(MissionJournalService).reloadFromStore(); break
      case 'layers': this.injector.get(LayerService).reloadFromStore(); break
      case 'secrets': this.injector.get(MissionService).reloadFromStore(); break
      default: break // a key no page here shows
    }
  }

  /** Re-reads every key a page shows. */
  async refreshAll(): Promise<void> {
    for (const key of ['appSettings', 'secrets', 'rangers', 'radioLog', 'locations', 'aarNotes', 'activityLogHeader', 'missionJournal', 'layers']) {
      await this.refresh(key)
    }
  }

  /** Asks the browser whether a main window holds the lock; reloads everything when one comes back. */
  async checkMainWindow(): Promise<void> {
    const open = await isMainWindowOpen()
    const was = this.mainWindowOpen()
    this.mainWindowOpen.set(open)
    if (open && !was) await this.refreshAll()
  }
}
