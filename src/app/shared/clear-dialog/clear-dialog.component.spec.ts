import { OverlayContainer } from '@angular/cdk/overlay'
import { TestBed } from '@angular/core/testing'
import { MatDialog } from '@angular/material/dialog'
import { provideRouter, Router } from '@angular/router'

import type { ClearId } from '../../domain/clear-choices'
import { buildClearRows } from '../../domain/clear-choices'
import type { ClearDialogData } from './clear-dialog.component'
import { ClearDialogComponent } from './clear-dialog.component'

const counts = {
  rangers: 42,
  photos: 5,
  entries: 318,
  places: 12,
  incidentNotes: 7,
  lines: 23,
  appNotes: 4,
}

/** E-221: the "What to clear" dialog. The row rules are tested in domain/clear-choices.spec.ts. */
describe('ClearDialogComponent (E-221)', () => {
  let overlay: HTMLElement

  async function open(over: Partial<ClearDialogData> = {}) {
    overlay = TestBed.inject(OverlayContainer).getContainerElement()
    const data: ClearDialogData = {
      title: 'Load the "Oso 2014" demo?',
      confirmLabel: 'Load demo',
      context: 'replace',
      rows: buildClearRows('replace', counts),
      attachmentNote: '',
      live: false,
      missionName: 'Fernhollow Drill',
      ...over,
    }
    const ref = TestBed.inject(MatDialog).open(ClearDialogComponent, { data })
    const results: unknown[] = []
    ref.afterClosed().subscribe((r) => results.push(r))
    await new Promise((r) => setTimeout(r, 300))
    return results
  }
  const q = (id: string) =>
    overlay.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  const settle = () => new Promise((r) => setTimeout(r, 400))

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }))
  afterEach(() => TestBed.inject(MatDialog).closeAll())

  it('shows the counts and the attachment line, and confirming with the defaults returns the locked rows plus the ticked ones', async () => {
    const results = await open({
      attachmentNote: '\n\nThis also deletes 2 attachments (3 MB) from this device.',
    })
    const text = overlay.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('42 rangers')
    expect(text).toContain('318 entries')
    expect(text).toContain('23 lines')
    expect(q('clear-attachments')!.textContent).toContain('2 attachments')
    expect(q('clear-unticked')).not.toBeNull() // the RangerTrak notes are unticked

    q('clear-confirm')!.click()
    await settle()
    expect([...(results[0] as Set<ClearId>)].sort()).toEqual([
      'header',
      'incidentNotes',
      'lines',
      'log',
      'photos',
      'places',
      'roster',
      'settings',
    ])
  })

  it('ticking the RangerTrak notes adds them; unticking a default removes it; Cancel returns null', async () => {
    const results = await open()
    ;(q('clear-appNotes')!.querySelector('input') as HTMLInputElement).click()
    ;(q('clear-lines')!.querySelector('input') as HTMLInputElement).click()
    q('clear-confirm')!.click()
    await settle()
    const ids = results[0] as Set<ClearId>
    expect(ids.has('appNotes')).toBe(true)
    expect(ids.has('lines')).toBe(false)

    const results2 = await open()
    q('clear-cancel')!.click()
    await settle()
    expect(results2).toEqual([null])
  })

  it('a live mission cannot be confirmed until the mission name (or REPLACE) is typed', async () => {
    const results = await open({ live: true })
    const confirm = q('clear-confirm') as HTMLButtonElement
    const type = q('clear-type') as HTMLInputElement
    expect(confirm.disabled).toBe(true)

    type.value = 'wrong'
    type.dispatchEvent(new Event('input'))
    await settle()
    expect(confirm.disabled).toBe(true)

    type.value = 'fernhollow drill'
    type.dispatchEvent(new Event('input'))
    await settle()
    expect(confirm.disabled).toBe(false)

    type.value = 'REPLACE'
    type.dispatchEvent(new Event('input'))
    await settle()
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await settle()
    expect(results.length).toBe(1)
  })

  it('outside a live mission there is no typing field; Back up first closes with null and goes to /mission', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    const results = await open()
    expect(q('clear-type')).toBeNull()
    expect((q('clear-confirm') as HTMLButtonElement).disabled).toBe(false)

    q('clear-backup')!.click()
    await settle()
    expect(results).toEqual([null])
    expect(navigate).toHaveBeenCalledWith(['/mission'])
  })

  it('leaves out rows with a zero count', async () => {
    await open({
      rows: buildClearRows('replace', { ...counts, photos: 0, lines: 0, appNotes: 0 }),
    })
    const text = overlay.textContent!
    expect(text).not.toContain('Ranger photos')
    expect(text).not.toContain('ICS-214 activity lines')
    expect(text).not.toContain('about RangerTrak')
    expect(text).toContain('Mission settings')
  })
})
