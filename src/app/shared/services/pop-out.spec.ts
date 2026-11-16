import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { Router, provideRouter } from '@angular/router'

import { announceWrite } from '../storage/data-channel'
import { installReadOnlyGuard, resetReadOnlyGuardForTests } from '../storage/read-only-window'
import { recordStore } from '../storage/record-store'
import { LOCK_NAME } from '../storage/tab-lock'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { DisplayService } from './display.service'
import { LayerService } from './layer.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { PopOutService } from './pop-out.service'
import { MAIN_CHECK_MS, POPOUT_DEBOUNCE_MS, PopOutSyncService } from './pop-out-sync.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'

/**
 * E-313: the pieces of a pop-out that follow the main window. Each service's reloadFromStore() takes what
 * RecordStore now holds and republishes it, without writing; PopOutSyncService wires keys to services.
 */
describe('pop-out services (E-313)', () => {
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([{ path: 'map', children: [] }, { path: 'summary', children: [] }])],
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    resetReadOnlyGuardForTests()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  /** Runs `body` with every write path spied, and expects it to have written nothing. */
  async function writesNothing(body: () => void | Promise<void>): Promise<void> {
    const spies = [
      vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'),
      vi.spyOn(IDBObjectStore.prototype, 'put'), vi.spyOn(IDBObjectStore.prototype, 'delete'),
    ]
    await body()
    await recordStore.flush()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  }

  describe('reloadFromStore()', () => {
    it('RangerService shows a roster the main window saved', async () => {
      const service = TestBed.inject(RangerService)
      expect(service.rangers.length).toBe(0)
      recordStore.setItem('rangers', JSON.stringify({ schemaVersion: 1, rangers: [{ callsign: 'KE7ABC', fullName: 'Pat Example' }] }))
      await recordStore.flush()
      recordStore.useReadOnly()
      const seen: number[] = []
      service.getRangersObserver().subscribe(r => seen.push(r.length))
      await writesNothing(() => service.reloadFromStore())
      expect(service.rangers.map(r => r.callsign)).toEqual(['KE7ABC'])
      expect(seen[seen.length - 1]).toBe(1)
    })

    it('RadioLogService shows entries the main window saved', async () => {
      const service = TestBed.inject(RadioLogService)
      const log = JSON.parse(JSON.stringify(service['radioLog']))
      log.logEntries = [{
        id: 1, callsign: 'KE7ABC', location: { lat: 47.4, lng: -122.4, address: '', derivedFromAddress: false },
        date: new Date().toISOString(), status: 'Normal', notes: 'hello',
      }]
      log.numReport = 1
      recordStore.setItem('radioLog', JSON.stringify(log))
      await recordStore.flush()
      recordStore.useReadOnly()
      await writesNothing(() => service.reloadFromStore())
      expect(service['radioLog'].logEntries.length).toBe(1)
      expect(service['radioLogSignal']().logEntries.length).toBe(1)
    })

    it('MissionLocationService shows places the main window saved', async () => {
      const service = TestBed.inject(MissionLocationService)
      recordStore.setItem('locations', JSON.stringify({
        schemaVersion: 1, locations: [{ uid: 'a', name: 'Trailhead', category: 'other', lat: 47.4, lng: -122.4 }],
      }))
      await recordStore.flush()
      recordStore.useReadOnly()
      await writesNothing(() => service.reloadFromStore())
      expect(service.getCurrentLocations().map(l => l.name)).toEqual(['Trailhead'])
    })

    it('AarNoteService, ActivityLogHeaderService, MissionJournalService and LayerService re-read their key', async () => {
      const aar = TestBed.inject(AarNoteService)
      const journal = TestBed.inject(MissionJournalService)
      const header = TestBed.inject(ActivityLogHeaderService)
      const layers = TestBed.inject(LayerService)

      // What the main window would have stored: a real journal entry, made and then taken back out of memory.
      journal.record('mode-changed', 'Changed the mission mode.')
      const journalJson = recordStore.getItem('missionJournal')!
      expect(journalJson).toBeTruthy()
      recordStore.removeItem('missionJournal')
      journal.reloadFromStore()
      expect(journal.entries().length).toBe(0)

      recordStore.setItem('aarNotes', JSON.stringify({
        schemaVersion: 1, notes: [{ uid: 'n1', text: 'Radios died', about: 'incident', page: 'Map', createdAt: new Date().toISOString() }],
      }))
      recordStore.setItem('missionJournal', journalJson)
      recordStore.setItem('activityLogHeader', JSON.stringify({ name: 'Test fire' }))
      await recordStore.flush()
      recordStore.useReadOnly()
      await writesNothing(() => {
        aar.reloadFromStore(); journal.reloadFromStore(); header.reloadFromStore(); layers.reloadFromStore()
      })
      expect(aar.notes().length).toBe(1)
      expect(journal.entries().length).toBe(1)
      expect(header.getCurrentHeader().name).toBe('Test fire')
    })

    it('MissionService shows settings the main window saved, keeping the running version', async () => {
      const service = TestBed.inject(MissionService)
      const running = service.settings.version
      const saved = { ...service.settings, mission: 'Lost hiker, Snoqualmie', googleGeocodingApiKey: '', boardPassword: '' }
      localStorage.setItem('appSettings', JSON.stringify({ ...saved, version: '0.0.1' }))
      installReadOnlyGuard()
      recordStore.useReadOnly()
      await writesNothing(() => service.reloadFromStore())
      expect(service.settings.mission).toBe('Lost hiker, Snoqualmie')
      expect(service.settings.version).toBe(running)
    })

    it('MissionService in a read-only window publishes at boot and writes no settings', async () => {
      installReadOnlyGuard()
      recordStore.useReadOnly()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await writesNothing(() => { TestBed.inject(MissionService) })
      expect(localStorage.getItem('appSettings')).toBeNull()
      expect(warn.mock.calls.filter(c => String(c[0]).startsWith('read-only window: blocked'))).toEqual([])
    })
  })

  describe('PopOutSyncService', () => {
    it('hands each announced key to the service that owns it, once per burst', async () => {
      installReadOnlyGuard()
      recordStore.useReadOnly()
      const log = TestBed.inject(RadioLogService)
      const reload = vi.spyOn(log, 'reloadFromStore')
      const sync = TestBed.inject(PopOutSyncService)
      sync.start()

      announceWrite('radioLog'); announceWrite('radioLog'); announceWrite('radioLog')
      await wait(POPOUT_DEBOUNCE_MS + 250)
      expect(reload).toHaveBeenCalledTimes(1)
      sync.ngOnDestroy()
    })

    it('refresh() routes every key a page shows, and ignores one it does not', async () => {
      installReadOnlyGuard()
      recordStore.useReadOnly()
      const sync = TestBed.inject(PopOutSyncService)
      const targets: Array<[string, { reloadFromStore(): void }]> = [
        ['rangers', TestBed.inject(RangerService)], ['radioLog', TestBed.inject(RadioLogService)],
        ['locations', TestBed.inject(MissionLocationService)], ['aarNotes', TestBed.inject(AarNoteService)],
        ['activityLogHeader', TestBed.inject(ActivityLogHeaderService)], ['missionJournal', TestBed.inject(MissionJournalService)],
        ['layers', TestBed.inject(LayerService)], ['secrets', TestBed.inject(MissionService)],
        ['appSettings', TestBed.inject(MissionService)],
      ]
      for (const [key, service] of targets) {
        const spy = vi.spyOn(service, 'reloadFromStore')
        await sync.refresh(key)
        expect(spy, key).toHaveBeenCalled()
      }
      const other = vi.spyOn(TestBed.inject(RangerService), 'reloadFromStore')
      other.mockClear()
      await sync.refresh('importSafetyCopy')
      expect(other).not.toHaveBeenCalled()
    })

    it('says when no main window holds the lock, and re-reads everything when one comes back', async () => {
      installReadOnlyGuard()
      recordStore.useReadOnly()
      const sync = TestBed.inject(PopOutSyncService)
      const query = vi.spyOn(navigator.locks, 'query')
      const all = vi.spyOn(sync, 'refreshAll').mockResolvedValue(undefined)

      query.mockResolvedValue({ held: [], pending: [] })
      await sync.checkMainWindow()
      expect(sync.mainWindowOpen()).toBe(false)
      expect(all).not.toHaveBeenCalled()

      query.mockResolvedValue({ held: [{ name: LOCK_NAME, mode: 'exclusive', clientId: 'x' }], pending: [] })
      await sync.checkMainWindow()
      expect(sync.mainWindowOpen()).toBe(true)
      expect(all).toHaveBeenCalledTimes(1)
    })

    it('checks on a timer and when the window is shown again', async () => {
      vi.useFakeTimers()
      try {
        installReadOnlyGuard()
        recordStore.useReadOnly()
        const sync = TestBed.inject(PopOutSyncService)
        const check = vi.spyOn(sync, 'checkMainWindow').mockResolvedValue(undefined)
        sync.start()
        expect(check).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(MAIN_CHECK_MS)
        expect(check).toHaveBeenCalledTimes(2)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(check).toHaveBeenCalledTimes(3)
        sync.ngOnDestroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does nothing outside a read-only window', () => {
      const sync = TestBed.inject(PopOutSyncService)
      const check = vi.spyOn(sync, 'checkMainWindow')
      sync.start()
      expect(check).not.toHaveBeenCalled()
    })
  })

  describe('PopOutService', () => {
    it('opens the page on screen, with its parameters, as a read-only Display window', async () => {
      await TestBed.inject(Router).navigateByUrl('/map?layer=1&display=0')
      const url = new URL(TestBed.inject(PopOutService).popOutUrl())
      expect(url.origin).toBe(location.origin)
      expect(url.pathname.endsWith('/map')).toBe(true)
      expect(Object.fromEntries(url.searchParams)).toEqual({ layer: '1', display: '1', popout: '1' })
    })

    it('opens one new window per click, each with its own name, and says so when the browser blocks it', async () => {
      await TestBed.inject(Router).navigateByUrl('/summary')
      const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
      const service = TestBed.inject(PopOutService)
      await service.open()
      await service.open()
      expect(open).toHaveBeenCalledTimes(2)
      expect(new Set(open.mock.calls.map(c => c[1])).size).toBe(2)
      expect(String(open.mock.calls[0][0])).toContain('popout=1')

      open.mockReturnValue(null)
      const snack = vi.spyOn(service['snackbar'], 'open').mockReturnValue(undefined as never)
      await service.open()
      expect(snack).toHaveBeenCalled()
    })
  })

  describe('DisplayService in a read-only window', () => {
    it('is always in Display and cannot be left', async () => {
      installReadOnlyGuard()
      const display = TestBed.inject(DisplayService)
      expect(display.readOnly).toBe(true)
      expect(display.active()).toBe(true)
      await display.exit()
      expect(display.active()).toBe(true)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(display.active()).toBe(true)
    })
  })
})
