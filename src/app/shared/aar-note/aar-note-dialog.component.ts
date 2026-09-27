import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'

import { MATERIAL_IMPORTS } from '../../material-imports'
import { AAR_NOTE_ABOUT_LABELS, AarNoteAbout, AarNoteService } from '../services'

export interface AarNoteDialogData {
  /** The page the note is being taken on, recorded with it as context. */
  page: string
}

/**
 * E-116: capture one After Action note without leaving the current page. One text field and
 * an About toggle; everything else is filled in later on the After Action page. Enter does
 * not save (the text is multi-line); Esc cancels, and MatDialog returns focus to the header
 * button that opened it.
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

  constructor(
    private dialogRef: MatDialogRef<AarNoteDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AarNoteDialogData,
    private notes: AarNoteService,
  ) { }

  onSave(): void {
    if (this.notes.addNote(this.text(), this.about(), this.data.page)) {
      this.dialogRef.close(true)
    }
  }

  onCancel(): void {
    this.dialogRef.close(false)
  }
}
