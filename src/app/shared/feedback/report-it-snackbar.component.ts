import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatSnackBarModule, MatSnackBarRef } from '@angular/material/snack-bar'

/**
 * E-258 (2026-10-28, John): the "Something went wrong" prompt with two actions. Material's plain
 * snackbar allows only one, and John asked for "Don't show again" beside "Report it". The ref's
 * dismissal reason says which was pressed - see GlobalErrorHandler.offerReport().
 */
@Component({
  selector: 'rangertrak-report-it-snackbar',
  standalone: true,
  imports: [MatButtonModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span matSnackBarLabel>Something went wrong.</span>
    <span matSnackBarActions>
      <button matButton matSnackBarAction (click)="ref.dismissWithAction()">Report it</button>
      <button matButton matSnackBarAction (click)="dontShowAgain()">Don't show again</button>
    </span>
  `,
})
export class ReportItSnackbarComponent {
  ref = inject(MatSnackBarRef<ReportItSnackbarComponent>)
  muted = false

  dontShowAgain(): void {
    this.muted = true
    this.ref.dismiss()
  }
}
