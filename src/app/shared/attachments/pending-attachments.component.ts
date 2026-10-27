import { ChangeDetectionStrategy, Component, model } from '@angular/core'
import { MatButtonToggleModule } from '@angular/material/button-toggle'

import { formatBytes } from '../../domain/attachments'
import type { PendingAttachment } from './attachment-intake.service'
import { kindOf } from './compress/compress-types'

/**
 * The chips for files picked but not yet stored (Entry's Attach, and Add in the viewer): each shows
 * its name and size, a remove button, and where a smaller copy can be made, the sender's two-way
 * choice. ADR D-60 item 2, revised 2026-10-17 (E-194): **Keep original** is selected by default; the
 * tone is mild and encouraging, because the sender knows best what they are sending.
 */
@Component({
  selector: 'rangertrak-pending-attachments',
  standalone: true,
  imports: [MatButtonToggleModule],
  template: `
    @if (items().length) {
    <ul class="rt-pending" aria-label="Files waiting to be attached">
      @for (item of items(); track $index; let i = $index) {
      <li class="rt-pending__item" data-testid="pending-attachment">
        <span class="rt-pending__file">
          {{ item.file.name }} ({{ size(item.file.size) }})
          <button type="button" class="rt-pending__remove" [attr.aria-label]="'Do not attach ' + item.file.name"
            (click)="remove(i)">&times;</button>
        </span>
        @if (item.offer) {
        <mat-button-toggle-group class="rt-pending__choice" hideSingleSelectionIndicator
          [attr.aria-label]="'Size of ' + item.file.name" [value]="item.smaller ? 'smaller' : 'keep'"
          (change)="choose(i, $event.value === 'smaller')">
          <mat-button-toggle value="keep" data-testid="pending-keep">Keep original</mat-button-toggle>
          <mat-button-toggle value="smaller" data-testid="pending-smaller">Smaller copy</mat-button-toggle>
        </mat-button-toggle-group>
        @if (item.smaller) {
        <small class="rt-pending__note" data-testid="pending-smaller-note">
          Sends much faster over a field network, but fine detail isn't kept. Location, time and
          {{ kind(item.file) === 'image' ? 'camera' : 'device' }} data are kept wherever the file has them.
          @if (item.estimate) { Expect about {{ size(item.estimate) }}. }
        </small>
        }
        }
      </li>
      }
    </ul>
    }
  `,
  styles: [`
    .rt-pending { display: flex; flex-direction: column; gap: 0.5em; list-style: none; margin: 0; padding: 0; width: 100%; }
    .rt-pending__item { align-items: center; display: flex; flex-wrap: wrap; gap: 0.25em 0.75em; }
    .rt-pending__file { border: 1px solid currentColor; border-radius: 999px; font-size: 0.85em; padding: 0 0.25em 0 0.75em; }
    .rt-pending__remove { background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 1.1em; padding: 0 0.4em; }
    .rt-pending__choice { --mat-button-toggle-height: 32px; --mat-button-toggle-label-text-size: 0.8rem; }
    .rt-pending__note { color: var(--rt-muted, #666); flex-basis: 100%; }
  `],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class PendingAttachmentsComponent {
  readonly items = model<PendingAttachment[]>([])

  size(bytes: number): string { return formatBytes(bytes) }
  kind(file: File) { return kindOf(file.type) }

  remove(index: number): void { this.items.update(list => list.filter((_, i) => i !== index)) }

  choose(index: number, smaller: boolean): void {
    this.items.update(list => list.map((item, i) => (i === index ? { ...item, smaller } : item)))
  }
}
