import { provideHttpClient } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { MatDialog } from '@angular/material/dialog'
import { of } from 'rxjs'
import type { Mock } from 'vitest'

import { ImportSafetyService } from '../services/import-safety.service'
import { RadioLogService } from '../services/radio-log.service'
import { recordStore } from '../storage/record-store'
import { ImportSafetyCardComponent } from './import-safety-card.component'

/** E-198 phase 1: the "Undo last import" card in Mission > Data safety (and on a field phone's Entry page). */
describe('ImportSafetyCardComponent (E-198)', () => {
  let fixture: ComponentFixture<ImportSafetyCardComponent>
  let safety: ImportSafetyService
  let radioLog: RadioLogService
  let dialog: MatDialog

  const el = () => fixture.nativeElement as HTMLElement
  const q = (id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  function addEntry(notes: string) {
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'FERN-1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes,
      })
    )
  }

  /** Answers the choice dialog with each value in turn, recording what it was asked. */
  function answerDialog(...answers: (string | undefined)[]) {
    const asked: any[] = []
    vi.spyOn(dialog, 'open').mockImplementation(((_c: unknown, config: any) => {
      asked.push(config.data)
      return { afterClosed: () => of(answers.shift()) }
    }) as any)
    return asked
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    safety = TestBed.inject(ImportSafetyService)
    radioLog = TestBed.inject(RadioLogService)
    dialog = TestBed.inject(MatDialog)
    await radioLog.deleteAllRadioLogEntries()
    fixture = TestBed.createComponent(ImportSafetyCardComponent)
    fixture.detectChanges()
  })

  afterEach(async () => {
    await safety.discard()
    await radioLog.deleteAllRadioLogEntries()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('shows nothing while there is no safety copy', () => {
    expect(q('import-safety-card')).toBeNull()
  })

  it('shows what the last import was, with Undo and Discard, once a copy exists', async () => {
    await safety.take('restore', 'rangertrak-Ops-2026-10-17.json')
    fixture.detectChanges()

    const text = q('import-safety-text')!.textContent!.replace(/\s+/g, ' ')
    expect(text).toMatch(
      /Last import: Restore of "rangertrak-Ops-2026-10-17\.json", \d\d:\d\d\./
    )
    expect(text).toContain('Undo puts back the mission as it was just before.')
    expect(q('import-safety-undo')).not.toBeNull()
    expect(q('import-safety-discard')).not.toBeNull()
  })

  it('says a merge is undone as a whole-device put-back', async () => {
    await safety.take('report-packet', 'p.txt')
    fixture.detectChanges()
    expect(q('import-safety-text')!.textContent).toContain(
      'whole mission as it was just before this merge'
    )
  })

  it('Discard safety copy asks first, then removes the copy and the card', async () => {
    await safety.take('restore', 'a.json')
    fixture.detectChanges()

    vi.spyOn(window, 'confirm').mockReturnValue(false)
    q('import-safety-discard')!.click()
    await fixture.whenStable()
    expect(safety.last()).not.toBeNull()

    ;(window.confirm as Mock).mockReturnValue(true)
    await fixture.componentInstance.onDiscard()
    fixture.detectChanges()
    expect(safety.last()).toBeNull()
    expect(q('import-safety-card')).toBeNull()
  })

  describe('Undo', () => {
    beforeEach(() => {
      vi.spyOn(fixture.componentInstance, 'reloadPage').mockResolvedValue()
      vi.spyOn(window, 'alert').mockReturnValue(undefined)
    })

    it('names what would be lost and puts the mission back when the person says Undo', async () => {
      addEntry('original')
      await safety.take('restore', 'a.json')
      addEntry('since 1')
      addEntry('since 2')
      const asked = answerDialog('undo')

      await fixture.componentInstance.onUndo()

      expect(asked.length).toBe(1)
      expect(asked[0].paragraphs[0]).toMatch(
        /^2 entries logged since \d\d:\d\d will be lost\. Back them up first\?$/
      )
      expect(asked[0].actions.map((a: any) => a.label)).toEqual(['Back up first', 'Undo'])
      expect(radioLog.getCurrentRadioLog().logEntries.map((e) => e.notes)).toEqual([
        'original',
      ])
      expect(safety.last()).toBeNull()
      expect(fixture.componentInstance.reloadPage).toHaveBeenCalled()
    })

    it('does nothing on Cancel', async () => {
      addEntry('original')
      await safety.take('restore', 'a.json')
      addEntry('since')
      answerDialog(undefined)

      await fixture.componentInstance.onUndo()

      expect(radioLog.getCurrentRadioLog().logEntries.length).toBe(2)
      expect(safety.last()).not.toBeNull()
      expect(fixture.componentInstance.reloadPage).not.toHaveBeenCalled()
    })

    it('offers the backup first, then asks again', async () => {
      addEntry('original')
      await safety.take('restore', 'a.json')
      addEntry('since')
      const asked = answerDialog('backup', undefined)
      vi.spyOn(window, 'confirm').mockReturnValue(false) // the backup is declined: back to the question

      await fixture.componentInstance.onUndo()

      expect(asked.length).toBe(2)
      expect(window.confirm).toHaveBeenCalled()
      expect(safety.last()).not.toBeNull()
    })

    it('asks a plain confirm, with no dialog, when nothing would be lost', async () => {
      addEntry('original')
      await safety.take('restore', 'a.json')
      const open = vi.spyOn(dialog, 'open').mockReturnValue(undefined as never)
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      await fixture.componentInstance.onUndo()

      expect(open).not.toHaveBeenCalled()
      expect(window.confirm).toHaveBeenCalled()
      expect(safety.last()).toBeNull()
    })
  })
})
