import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'

import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatDialogModule } from '@angular/material/dialog'
import { AarNoteAbout, AarNoteKind, AarNoteService, FieldModeService } from '../services'
import { DevicePrefsService } from '../services/device-prefs.service'

/** `YYYY-MM-DDTHH:mm` in local time, the value format of an `<input type="datetime-local">`. */
function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface AarNoteDialogData {
  /** The page the note is being taken on, recorded with it as context. */
  page: string
}

/**
 * E-116: capture one AAR note without leaving the current page. One text field and an About
 * toggle; everything else is filled in later on the AAR notes page. Enter does not save (the
 * text is multi-line); Esc cancels, and MatDialog returns focus to the header button that
 * opened it.
 *
 * 2026-09-27: the AAR notes page came off the main nav (navbar.component.html) the same day
 * this dialog's "See all notes (N)" link was added - it's the replacement way in, alongside
 * a direct link/bookmark to /after-action.
 *
 * E-04 / D-63: the same box also captures an ICS-214 activity line (the button is "AAR/214"). A
 * kind choice sits on top and starts on the kind used last on this device; a 214 line has a
 * time (prefilled with now, editable: scribes log late) and no About choice. Field mode keeps
 * the plain AAR note: no kind choice, always 'aar'.
 */
@Component({
  selector: 'rangertrak-aar-note-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatButtonToggleModule, MatDialogModule],
  templateUrl: './aar-note-dialog.component.html',
  styleUrls: ['./aar-note-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AarNoteDialogComponent {
  text = signal('')
  about = signal<AarNoteAbout>('incident')

  /** E-04 / D-63: field phones get no 214 in tier 1, so no choice there. */
  readonly choosesKind: boolean
  kind = signal<AarNoteKind>('aar')
  /** The 214 line's time as the datetime-local field shows it; opens on now. */
  private readonly openedAt = toLocalInputValue(new Date())
  at = signal(this.openedAt)

  /** 2026-09-27: drives the "See all notes (N)" link below - hidden entirely at 0. */
  readonly noteCount = computed(() => this.notes.notes().filter(n => n.kind === 'aar').length)

  constructor(
    private dialogRef: MatDialogRef<AarNoteDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AarNoteDialogData,
    private notes: AarNoteService,
    private router: Router,
    fieldMode: FieldModeService,
    /** E-04 / D-63: remembers the kind used last, per device (ARCHITECTURE.md row 28). */
    private prefs: DevicePrefsService,
  ) {
    this.choosesKind = !fieldMode.enabled()
    if (this.choosesKind) this.kind.set(this.prefs.getAarNoteLastKind())
  }

  /** E-230: the dialog's one choice - an AAR note's About, or an ICS-214 line. */
  readonly choice = computed<AarNoteAbout | 'activity'>(() => this.kind() === 'activity' ? 'activity' : this.about())

  onChoiceChange(choice: AarNoteAbout | 'activity'): void {
    if (choice === 'activity') {
      this.onKindChange('activity')
      return
    }
    this.about.set(choice)
    if (this.kind() !== 'aar') this.onKindChange('aar')
  }

  onKindChange(kind: AarNoteKind): void {
    this.kind.set(kind)
    this.prefs.setAarNoteLastKind(kind)
  }

  onSave(): void {
    const kind = this.kind()
    // The edited time is stored only when it differs from the time the box opened with (D-63 item 2).
    let at: string | undefined
    if (kind === 'activity' && this.at() && this.at() !== this.openedAt) {
      const d = new Date(this.at())
      if (!isNaN(d.getTime())) at = d.toISOString()
    }
    if (this.notes.addNote(this.text(), this.about(), this.data.page, kind, at)) {
      this.dialogRef.close(true)
    }
  }

  /** E-04 / D-63: the After Action page holds the 214 list and the export. Closes unsaved, like onSeeAll(). */
  on214Log(): void {
    this.dialogRef.close(false)
    this.router.navigate(['/after-action'])
  }

  onCancel(): void {
    this.dialogRef.close(false)
  }

  /**
   * 2026-09-27: closes the dialog (unsaved text is lost, same as Cancel - there is no
   * partial-save concept here) and jumps straight to the review page. Closes with `false`,
   * not `true`: the header's afterClosed() subscriber only offers the "View" snackbar when a
   * note was actually SAVED (E-116) - already navigating there makes that snackbar redundant,
   * not helpful.
   */
  onSeeAll(): void {
    this.dialogRef.close(false)
    this.router.navigate(['/after-action'])
  }
}
