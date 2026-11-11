import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'

/** What the Radio Log page hands the dialog: the summary lines, and whether a receipt can be made. */
export type MergeSummaryDialogData = {
  lines: string[]
  /** False when none of the packet's reports are in this log (nothing to confirm). */
  canSendReceipt: boolean
}

/** What the dialog hands back: `'send'` for Send a receipt, otherwise nothing. */
export type MergeSummaryDialogResult = 'send' | undefined

/**
 * E-260 (D-69): what a Report Packet merge did, with an offer to send a receipt back to the
 * phone. Replaces the plain alert for a Report Packet merge only. Loaded with a dynamic import on
 * first use, so it stays out of the eager bundle. No setting turns the offer off (Q56).
 */
@Component({
  selector: 'rangertrak-merge-summary-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <h2 mat-dialog-title>Reports merged</h2>
    <mat-dialog-content>
      @for (line of data.lines; track $index) {
        <p>{{ line }}</p>
      }
      @if (data.canSendReceipt) {
        <p>A receipt lets the sender's phone mark these reports as received. It lists report numbers only, no report text.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="undefined">OK</button>
      @if (data.canSendReceipt) {
        <button matButton="filled" type="button" [mat-dialog-close]="'send'" cdkFocusInitial>Send a receipt</button>
      }
    </mat-dialog-actions>
  `,
})
export class MergeSummaryDialogComponent {
  protected data = inject<MergeSummaryDialogData>(MAT_DIALOG_DATA)
}
