import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { recordStore } from '../storage/record-store'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
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
