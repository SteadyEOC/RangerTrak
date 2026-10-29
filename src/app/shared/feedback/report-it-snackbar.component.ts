import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MAT_SNACK_BAR_DATA, MatSnackBarModule, MatSnackBarRef } from '@angular/material/snack-bar'

/** Which of the session's prompts this is, for the "Notice 1 of 3" line. */
export interface ReportItData {
  n: number
  max: number
}

/**
 * E-258 (2026-10-28, John): the "Something went wrong" prompt with three actions. Material's plain
 * snackbar allows only one, and John asked for "Don't show again" beside "Report it". The ref's
 * dismissal reason says which was pressed - see GlobalErrorHandler.offerReport().
 *
 * John 10-29: it stays until someone presses a button (15 seconds was too easy to miss in the
 * field), it is amber with an orange border (panel class `rt-report-it` in styles.scss), and it
 * counts itself - "Notice 1 of 3" - so people know these won't go on forever.
 */
@Component({
  selector: 'rangertrak-report-it-snackbar',
  standalone: true,
  imports: [MatButtonModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span matSnackBarLabel>
      <strong>Something went wrong.</strong>
      <span class="count">Notice {{ data.n }} of {{ data.max }} at most this session</span>
    </span>
    <span matSnackBarActions>
      <button matButton matSnackBarAction (click)="ref.dismissWithAction()">Report it</button>
      <button matButton matSnackBarAction (click)="ref.dismiss()">Dismiss</button>
      <button matButton matSnackBarAction (click)="dontShowAgain()">Don't show again</button>
    </span>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; }
    [matSnackBarLabel] { display: flex; flex-direction: column; gap: 2px; }
    .count { font-size: var(--mat-sys-body-small-size); }
    [matSnackBarActions] { flex-wrap: wrap; }
  `,
})
export class ReportItSnackbarComponent {
  ref = inject(MatSnackBarRef<ReportItSnackbarComponent>)
  data = inject<ReportItData>(MAT_SNACK_BAR_DATA)
  muted = false

  dontShowAgain(): void {
    this.muted = true
    this.ref.dismiss()
  }
}
