import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'

import { netSummary, netSummaryText, type NetSummaryContext } from '../../domain/net-summary'

export type NetSummaryDialogData = {
  /** The entries in view: what the Radio Log grid is showing now (op-period toggle and filters applied). */
  entries: ReadonlyArray<Parameters<typeof netSummary>[0][number]>
  ctx: NetSummaryContext
  head: { mission?: string; opPeriod?: string }
  /** The station letters among those entries; the picker shows only with 2 or more. */
  letters: string[]
}

/**
 * E-326: the net summary in a small dialog: a monospace block the scribe copies. Nothing is stored. Loaded by a
 * dynamic import on first use, so it stays out of the eager bundle.
 */
@Component({
  selector: 'rangertrak-net-summary-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`pre { font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; margin: 0 0 1rem; overflow-x: auto; }`],
  template: `
    <h2 mat-dialog-title>Net summary</h2>
    <mat-dialog-content>
      @if (data.letters.length >= 2) {
        <mat-form-field floatLabel="always">
          <mat-label>Station</mat-label>
          <mat-select [value]="station()" (selectionChange)="station.set($event.value)" data-testid="net-summary-station">
            <mat-option value="">All stations</mat-option>
            @for (l of data.letters; track l) { <mat-option [value]="l">Station {{ l }}</mat-option> }
          </mat-select>
        </mat-form-field>
      }
      <pre data-testid="net-summary-text">{{ text() }}</pre>
      @if (note()) { <p role="status">{{ note() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" mat-dialog-close>Close</button>
      <button matButton="filled" type="button" (click)="copy()" data-testid="net-summary-copy" cdkFocusInitial>Copy</button>
    </mat-dialog-actions>
  `,
})
export class NetSummaryDialogComponent {
  protected data = inject<NetSummaryDialogData>(MAT_DIALOG_DATA)
  protected readonly station = signal('')
  protected readonly note = signal('')
  protected readonly text = computed(() => netSummaryText(
    netSummary(this.data.entries, this.data.ctx, this.station() || undefined),
    { ...this.data.head, station: this.station() || undefined }))

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text())
      this.note.set('Copied.')
    } catch {
      this.note.set('Could not copy. Select the text above and copy it by hand.')
    }
  }
}
