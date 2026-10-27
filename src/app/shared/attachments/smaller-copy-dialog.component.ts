import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'

/** What opens the receiver's dialog: who sent the file, and what kind it is. */
export interface SmallerCopyDialogData {
  /** The original reference's `addedBy`: who sent it. May be blank. */
  from: string
  kind: 'image' | 'video' | 'audio' | 'other'
}

/** 'keep' adds the copy beside the original (the default); 'replace' also retires the original. */
export type SmallerCopyChoice = 'keep' | 'replace'

/**
 * The receiver's warning before making a smaller copy of someone else's file (ADR D-60 item 2,
 * revised 2026-10-17; E-194). Stronger than the sender's: the fingerprint proves the file is exactly
 * what was sent, and a smaller copy will not match it. **Keep both** is the default and adds the
 * copy beside the original; **Replace the original** needs a typed REPLACE, in any mode. Lazy: it
 * is opened only from the viewer.
 */
@Component({
  selector: 'rangertrak-smaller-copy-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Make a smaller copy?</h2>
    <div mat-dialog-content>
      <p data-testid="smaller-copy-warning">
        This file came from <strong>{{ data.from || 'the sender' }}</strong>. Its fingerprint proves it is exactly the
        file they sent. A smaller copy won't match that fingerprint, and it won't keep the fine detail
        (location, time and {{ data.kind === 'image' ? 'camera' : 'device' }} data are kept wherever the file has them).
        The original is kept unless you choose to replace it.
      </p>
      @if (replacing()) {
      <p>The original will be deleted from this device. The entry keeps a note that it was replaced, and when and by whom.</p>
      <mat-form-field appearance="outline">
        <mat-label>Type REPLACE to go ahead</mat-label>
        <input matInput autocomplete="off" data-testid="smaller-copy-replace-input" [value]="typed()"
          (input)="typed.set($any($event.target).value)" />
      </mat-form-field>
      }
    </div>
    <div mat-dialog-actions>
      <button matButton type="button" mat-dialog-close data-testid="smaller-copy-cancel-dialog">Cancel</button>
      @if (!replacing()) {
      <button matButton="outlined" type="button" data-testid="smaller-copy-replace" (click)="replacing.set(true)">
        Replace the original…
      </button>
      } @else {
      <button matButton="outlined" type="button" data-testid="smaller-copy-replace-go" [disabled]="!confirmed()"
        [mat-dialog-close]="'replace'">Replace the original</button>
      }
      <button matButton="filled" type="button" data-testid="smaller-copy-keep" cdkFocusInitial
        [mat-dialog-close]="'keep'">Keep both</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SmallerCopyDialogComponent {
  readonly data = inject<SmallerCopyDialogData>(MAT_DIALOG_DATA)
  readonly replacing = signal(false)
  readonly typed = signal('')
  readonly confirmed = computed(() => this.typed().trim().toLowerCase() === 'replace')
}
