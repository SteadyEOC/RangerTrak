import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'

import { MATERIAL_IMPORTS } from '../../material-imports'
import { AAR_NOTE_ABOUT_LABELS, AarNoteAbout, AarNoteService } from '../services'

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
 */
@Component({
  selector: 'rangertrak-aar-note-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './aar-note-dialog.component.html',
  styleUrls: ['./aar-note-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AarNoteDialogComponent {
  readonly aboutLabels = AAR_NOTE_ABOUT_LABELS
  text = signal('')
  about = signal<AarNoteAbout>('incident')

  /** 2026-09-27: drives the "See all notes (N)" link below - hidden entirely at 0. */
  readonly noteCount = computed(() => this.notes.notes().length)

  constructor(
    private dialogRef: MatDialogRef<AarNoteDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AarNoteDialogData,
    private notes: AarNoteService,
    private router: Router,
  ) { }

  onSave(): void {
    if (this.notes.addNote(this.text(), this.about(), this.data.page)) {
      this.dialogRef.close(true)
    }
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
