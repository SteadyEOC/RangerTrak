import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { recordStore } from '../storage/record-store'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { RangerService } from './ranger.service'
import { RangerPhotoService } from './ranger-photo.service'
import { UsageStateService } from './usage-state.service'

/** E-221: what "Start a real mission" clears, and what the dialog is told the counts are. */
describe('UsageStateService.startRealMission (E-221)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    })
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  function seed() {
    const notes = TestBed.inject(AarNoteService)
    const header = TestBed.inject(ActivityLogHeaderService)
    notes.addNote('incident note', 'incident', 'Map')
    notes.addNote('incident note 2', 'incident', 'Map')
    notes.addNote('app note', 'app', 'Map')
    ;['one', 'two', 'three'].forEach((t) =>
      notes.addNote(t, 'incident', 'Map', 'activity')
    )
    header.save({ name: 'Pat', icsPosition: 'Scribe', homeAgency: 'CERT', resources: [] })
    return { notes, header }
  }

  it('counts the incident notes, 214 lines and RangerTrak notes apart', () => {
    seed()
    const c = TestBed.inject(UsageStateService).clearCounts()
    expect([c.incidentNotes, c.lines, c.appNotes]).toEqual([2, 3, 1])
  })

  it('with the defaults leaves just the RangerTrak note, and clears the ranger photos', async () => {
    const { notes, header } = seed()
    const clearPhotos = vi
      .spyOn(TestBed.inject(RangerPhotoService), 'clear')
      .mockResolvedValue()

    await TestBed.inject(UsageStateService).startRealMission()

    expect(notes.notes().map((n) => n.text)).toEqual(['app note'])
    expect(header.getCurrentHeader().name).toBe('')
    expect(clearPhotos).toHaveBeenCalledTimes(1)
  })

  it('keeps everything optional that the caller did not name, and clears what it did', async () => {
    const { notes, header } = seed()
    vi.spyOn(TestBed.inject(RangerPhotoService), 'clear').mockResolvedValue()
    const usage = TestBed.inject(UsageStateService)

    await usage.startRealMission(undefined, new Set(['lines']))
    expect(
      notes
        .notes()
        .map((n) => n.text)
        .sort()
    ).toEqual(['app note', 'incident note', 'incident note 2'])
    expect(header.getCurrentHeader().name).toBe('Pat')

    await usage.startRealMission(
      undefined,
      new Set(['appNotes', 'incidentNotes', 'header'])
    )
    expect(notes.notes()).toEqual([])
    expect(header.getCurrentHeader().name).toBe('')
  })
})

/** E-319: what "Start the next mission" clears, and, as much, what it keeps. */
describe('UsageStateService.startNextMission (E-319)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideRouter([])] })
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  function setup() {
    const missions = TestBed.inject(MissionService)
    missions.updateMission({
      ...missions.settings,
      mission: 'Rim Sweep',
      event: 'Search',
      eventNotes: 'notes',
      opPeriod: '1',
      showMGRS: true,
      defLat: 12.5,
      missionMode: 'exercise',
      tacticalCalls: [{ name: 'Alpha' }] as never,
      scenarioClock: { realAt: '2026-11-01T00:00:00Z', scenarioAt: '2026-01-01T00:00:00Z' },
    })
    const rangers = vi.spyOn(TestBed.inject(RangerService), 'deleteAllRangers').mockImplementation(() => undefined)
    const photos = vi.spyOn(TestBed.inject(RangerPhotoService), 'clear').mockResolvedValue()
    const places = vi.spyOn(TestBed.inject(MissionLocationService), 'deleteAllLocations').mockImplementation(() => undefined)
    const notes = TestBed.inject(AarNoteService)
    notes.addNote('incident note', 'incident', 'Map')
    notes.addNote('app note', 'app', 'Map')
    notes.addNote('line', 'incident', 'Map', 'activity')
    const header = TestBed.inject(ActivityLogHeaderService)
    header.save({ name: 'Pat', icsPosition: 'Scribe', homeAgency: 'CERT', resources: [] })
    return { missions, rangers, photos, places, notes, header }
  }

  it('with only the always-cleared rows: clears the mission name, keeps the roster, places, tactical calls, mode and other settings', async () => {
    const { missions, rangers, photos, places } = setup()

    await TestBed.inject(UsageStateService).startNextMission(new Set(['log', 'identity']))

    const m = missions.settings
    expect([m.mission, m.event, m.eventNotes, m.opPeriod]).toEqual(['', '', '', ''])
    expect(m.scenarioClock).toBeUndefined()
    expect([m.showMGRS, m.defLat, m.missionMode]).toEqual([true, 12.5, 'exercise'])
    expect(m.tacticalCalls).toHaveLength(1)
    expect(rangers).not.toHaveBeenCalled()
    expect(photos).not.toHaveBeenCalled()
    expect(places).not.toHaveBeenCalled()
  })

  it('clears the roster with its photos, places, tactical calls and mode when chosen', async () => {
    const { missions, rangers, photos, places } = setup()

    await TestBed.inject(UsageStateService).startNextMission(new Set(['roster', 'places', 'tactical', 'mode']))

    expect(rangers).toHaveBeenCalledTimes(1)
    expect(photos).toHaveBeenCalledTimes(1)
    expect(places).toHaveBeenCalledTimes(1)
    expect(missions.settings.tacticalCalls).toEqual([])
    expect(missions.settings.missionMode).toBeUndefined()
    expect(missions.settings.showMGRS).toBe(true)
  })

  it('removes only the chosen notes and the 214 header, and writes a journal entry', async () => {
    const { notes, header } = setup()
    const journal = TestBed.inject(MissionJournalService)
    const record = vi.spyOn(journal, 'record')

    await TestBed.inject(UsageStateService).startNextMission(new Set(['lines', 'header']))

    expect(notes.notes().map((n) => n.text).sort()).toEqual(['app note', 'incident note'])
    expect(header.getCurrentHeader().name).toBe('')
    expect(record).toHaveBeenCalledWith('next-mission-started', expect.stringContaining('Started the next mission. Cleared:'))
  })
})
