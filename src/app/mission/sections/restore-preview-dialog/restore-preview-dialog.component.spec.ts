import { OverlayContainer } from '@angular/cdk/overlay'
import { TestBed } from '@angular/core/testing'
import { MatDialog } from '@angular/material/dialog'

import type { RestoreSide } from '../../../domain/restore-preview'
import { compareForRestore } from '../../../domain/restore-preview'
import type { RestorePreviewDialogData } from './restore-preview-dialog.component'
import { RestorePreviewDialogComponent } from './restore-preview-dialog.component'

const side = (over: Partial<RestoreSide>): RestoreSide => ({
  mission: 'Fernhollow Drill',
  exportedAt: '',
  appVersion: '',
  entries: [],
  rangers: 0,
  places: 0,
  aarNotes: 0,
  activityLines: 0,
  photos: 0,
  ...over,
})

/** E-198 phase 1: the Restore preview dialog. The comparison itself is tested in domain/restore-preview.spec.ts. */
describe('RestorePreviewDialogComponent (E-198)', () => {
  let overlay: HTMLElement

  async function open(data: RestorePreviewDialogData) {
    overlay = TestBed.inject(OverlayContainer).getContainerElement()
    const ref = TestBed.inject(MatDialog).open(RestorePreviewDialogComponent, { data })
    await new Promise((r) => setTimeout(r, 300))
    return ref
  }
  const q = (id: string) =>
    overlay.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  const preview = compareForRestore(
    side({ entries: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }], rangers: 12 }),
    side({
      mission: 'Last Week',
      entries: [{ uid: 'a' }],
      rangers: 10,
      appVersion: '0.99.57-alpha',
      exportedAt: '2026-10-10T09:00:00Z',
    }),
    '0.99.56-alpha'
  )

  beforeEach(() => TestBed.configureTestingModule({}))
  afterEach(() => TestBed.inject(MatDialog).closeAll())

  it('shows both columns, the line that matters, the 24-hour footer, and a newer-version warning', async () => {
    await open({ fileName: 'last-week.json', preview, attachmentNote: '' })

    const table = q('restore-preview-table')!.textContent!.replace(/\s+/g, ' ')
    expect(table).toContain('On this device')
    expect(table).toContain('In the file')
    expect(table).toContain('Last Week')
    const rows = Array.from(overlay.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.children).map((c) => c.textContent!.trim())
    )
    expect(rows).toContainEqual(['Radio log entries', '3', '1'])
    expect(q('restore-preview-notinfile')!.textContent!.trim()).toBe(
      '2 entries on this device are not in the file and will be replaced.'
    )
    expect(q('restore-preview-newer')!.textContent).toContain(
      'newer RangerTrak (0.99.57-alpha)'
    )
    expect(q('restore-preview-footer')!.textContent!.replace(/\s+/g, ' ')).toContain(
      'A safety copy is kept for 24 hours. Mission > Data safety > Undo last import.'
    )
    expect(q('restore-preview-attachments')).toBeNull()
  })

  it('puts the focus on Cancel, and closes with false for Cancel and true for Restore', async () => {
    const ref = await open({
      fileName: 'a.json',
      preview,
      attachmentNote:
        '\n\n2 attachments (3 MB) on this device are not in the restored mission.',
    })
    expect(document.activeElement).toBe(q('restore-preview-cancel'))
    expect(q('restore-preview-attachments')!.textContent).toContain('2 attachments')

    const results: unknown[] = []
    ref.afterClosed().subscribe((r) => results.push(r))
    q('restore-preview-restore')!.click()
    await new Promise((r) => setTimeout(r, 500))
    expect(results).toEqual([true])

    const ref2 = await open({ fileName: 'a.json', preview, attachmentNote: '' })
    ref2.afterClosed().subscribe((r) => results.push(r))
    q('restore-preview-cancel')!.click()
    await new Promise((r) => setTimeout(r, 500))
    expect(results).toEqual([true, false])
  })

  it('says every entry is also in the file when none would be lost', async () => {
    const same = compareForRestore(
      side({ entries: [{ uid: 'a' }] }),
      side({ entries: [{ uid: 'a' }, { uid: 'b' }] }),
      '0.99.56-alpha'
    )
    await open({ fileName: 'a.json', preview: same, attachmentNote: '' })
    expect(q('restore-preview-notinfile')!.textContent!.trim()).toBe(
      'Every entry on this device is also in the file.'
    )
    expect(q('restore-preview-newer')).toBeNull()
  })
})
