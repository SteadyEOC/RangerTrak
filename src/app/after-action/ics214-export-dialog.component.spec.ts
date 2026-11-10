import { provideHttpClient } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { MatDialogRef } from '@angular/material/dialog'
import { provideRouter } from '@angular/router'

import { AarNoteService, MissionService } from '../shared/services'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { recordStore } from '../shared/storage/record-store'
import { Ics214ExportDialogComponent } from './ics214-export-dialog.component'

describe('Ics214ExportDialogComponent journal suggestions (E-222 / D-67)', () => {
  let fixture: ComponentFixture<Ics214ExportDialogComponent>
  let component: Ics214ExportDialogComponent
  let notes: AarNoteService
  let journal: MissionJournalService

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({
      imports: [Ics214ExportDialogComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    })
    const mission = TestBed.inject(MissionService)
    mission.updateMission({ ...mission.settings, mission: 'Journal test' })
    notes = TestBed.inject(AarNoteService)
    journal = TestBed.inject(MissionJournalService)
    journal.record('print-309', 'Printed the ICS-309 log: 4 rows.')
    journal.record('print-213', 'ICS-213 for report 7: printed.') // never suggested
    journal.record('backup-exported', 'Exported a mission backup (NOT encrypted).')
    fixture = TestBed.createComponent(Ics214ExportDialogComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('offers mission and data actions, leaves out the 213 print, and ticks nothing', () => {
    expect(component.suggestions().map((s) => s.action)).toEqual([
      'print-309',
      'backup-exported',
    ])
    expect(component.ticked().size).toBe(0)
    expect(component.exportCount()).toBe(0)
    const text = (fixture.nativeElement as HTMLElement).textContent!
    expect(text).toContain('Suggested lines from this device')
    expect(text).toContain('Nothing goes on the form unless you tick it')
    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'mat-checkbox input'
    )
    expect(boxes.length).toBe(2)
    boxes.forEach((b) => expect((b as HTMLInputElement).checked).toBe(false))
  })

  it('adds a ticked suggestion as an ordinary 214 line, timed when it happened, and nothing for an unticked one', () => {
    const [first] = component.suggestions()
    component.setTicked(first.seq, true)
    expect(component.exportCount()).toBe(1)

    expect(component.addTickedSuggestions()).toBe(1)
    const lines = notes.getCurrentNotes().filter((n) => n.kind === 'activity')
    expect(lines.length).toBe(1)
    expect(lines[0].text).toBe(first.summary)
    expect(lines[0].at).toBe(first.at)
  })

  it('adds nothing when nothing is ticked', () => {
    expect(component.addTickedSuggestions()).toBe(0)
    expect(notes.getCurrentNotes().length).toBe(0)
  })

  it('hides a suggestion that already has a line with the same time and text', () => {
    const [first] = component.suggestions()
    notes.addNote(first.summary, 'incident', 'Journal', 'activity', first.at)
    fixture = TestBed.createComponent(Ics214ExportDialogComponent)
    expect(fixture.componentInstance.suggestions().map((s) => s.action)).toEqual([
      'backup-exported',
    ])
  })
})
