import { TestBed } from '@angular/core/testing'

import { canonical, sha256Hex } from '../../domain/mission-journal'
import { recordStore } from '../storage/record-store'
import { LogService } from './log.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionService } from './mission.service'

describe('MissionJournalService (E-222 / D-67)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('starts empty and intact on a device that has never recorded anything', () => {
    const service = TestBed.inject(MissionJournalService)
    expect(service.entries()).toEqual([])
    expect(service.verify().ok).toBe(true)
    expect(service.shortHead()).toMatch(/^jrnl 0000·0000 \(0\)$/)
  })

  it('appends chained entries with the mission name and mode at the time, and writes one debug log line', () => {
    const mission = TestBed.inject(MissionService)
    mission.updateMission({
      ...mission.settings,
      mission: 'Oso 2014',
      missionMode: 'exercise',
    })
    const log = TestBed.inject(LogService)
    const info = vi.spyOn(log, 'info')
    const service = TestBed.inject(MissionJournalService)

    service.record('print-309', 'Printed the ICS-309 log: 4 rows.')
    service.record('backup-exported', 'Exported a mission backup (NOT encrypted).')

    const [a, b] = service.entries()
    expect([a.seq, b.seq]).toEqual([1, 2])
    expect(a.mission).toBe('Oso 2014')
    expect(a.mode).toBe('exercise')
    expect(b.prev).toBe(a.hash)
    expect(service.verify()).toEqual(expect.objectContaining({ ok: true, count: 2 }))
    expect(service.head().head).toBe(b.hash)
    expect(info).toHaveBeenCalledTimes(2)
    expect(info).toHaveBeenCalledWith('Printed the ICS-309 log: 4 rows.', 'Journal')
  })

  it('persists a versioned wrapper, and a new service instance reads every entry back', () => {
    const service = TestBed.inject(MissionJournalService)
    service.record('demo-loaded', 'Loaded the "oso" demo.')
    const stored = JSON.parse(recordStore.getItem('missionJournal')!)
    expect(stored.schemaVersion).toBe(1)
    expect(stored.entries.length).toBe(1)

    TestBed.resetTestingModule()
    const reloaded = TestBed.inject(MissionJournalService)
    expect(reloaded.entries().length).toBe(1)
    expect(reloaded.verify().ok).toBe(true)
  })

  it('is saved synchronously, so an entry recorded just before a reload is in storage', () => {
    const service = TestBed.inject(MissionJournalService)
    service.record('mission-reset', 'Reset the mission settings to their defaults.')
    // No await, no flush: the in-memory store already holds it, and the queued write is what flush() awaits.
    expect(JSON.parse(recordStore.getItem('missionJournal')!).entries.length).toBe(1)
  })

  it('reports "broken at entry 2" when a stored summary is edited by hand', () => {
    const service = TestBed.inject(MissionJournalService)
    service.record('print-309', 'one')
    service.record('print-309', 'two')
    service.record('print-309', 'three')
    const stored = JSON.parse(recordStore.getItem('missionJournal')!)
    stored.entries[1].summary = 'edited'
    recordStore.setItem('missionJournal', JSON.stringify(stored))

    TestBed.resetTestingModule()
    const check = TestBed.inject(MissionJournalService).verify()
    expect(check.ok).toBe(false)
    expect(check.brokenAt).toBe(2)
  })

  it('has no way to edit, delete or clear an entry', () => {
    const service = TestBed.inject(MissionJournalService) as unknown as Record<
      string,
      unknown
    >
    for (const name of [
      'update',
      'edit',
      'delete',
      'remove',
      'clear',
      'reset',
      'deleteAll',
      'replaceAll',
    ]) {
      expect(service[name], name).toBeUndefined()
    }
  })

  it('hashes with the pure function (the stored hash is reproducible)', () => {
    const service = TestBed.inject(MissionJournalService)
    service.record('print-309', 'x')
    const { hash, ...rest } = service.entries()[0]
    expect(hash).toBe(sha256Hex(canonical(rest)))
  })
})
