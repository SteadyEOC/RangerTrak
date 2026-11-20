import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'

import { liveRefs } from '../../domain/attachments'
import type { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'
import { AttachmentViewerService } from './attachment-viewer.service'

/**
 * The 📎 N chip (ADR D-60, E-194): N is the entry's live attachments, and the chip is absent at
 * zero. Removed ones show only inside the viewer, which is what the chip opens. For templates;
 * the grid and the map popup build the same markup as a string (see `attachmentChipHtml`).
 */
@Component({
  selector: 'rangertrak-attachment-chip',
  standalone: true,
  template: `
    @if (count() > 0) {
    <button type="button" class="rt-attach-chip" data-testid="attachment-chip"
      [attr.data-entry-uid]="entry()?.uid"
      [attr.aria-label]="count() + (count() === 1 ? ' attachment' : ' attachments') + ', open'"
      (click)="open($event)">📎 {{ count() }}</button>
    }
  `,
  styleUrls: ['./attachment-chip.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AttachmentChipComponent {
  readonly entry = input<Pick<RadioLogEntryType, 'uid' | 'attachments'> | undefined>()
  readonly count = computed(() => { const e = this.entry(); return e ? liveRefs(e).length : 0 })

  private viewer = inject(AttachmentViewerService)

  open(event: Event): void {
    event.stopPropagation()
    void this.viewer.open(this.entry()?.uid)
  }
}
