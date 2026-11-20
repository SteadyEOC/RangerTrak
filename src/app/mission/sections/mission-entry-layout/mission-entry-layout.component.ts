import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core'
import { MatCardModule } from '@angular/material/card'
import { MatRadioModule } from '@angular/material/radio'
import { ENTRY_LAYOUTS, EntryLayout } from '../../../domain/entry-layout'

/**
 * E-332: which Entry screen this mission uses. A mission choice, not a power feature, so it is shown in both
 * the Easy and Full menus (D-62). The parent owns the value; this emits the new one (`layoutChange`).
 */
@Component({
  selector: 'rangertrak-mission-entry-layout',
  standalone: true,
  imports: [MatCardModule, MatRadioModule],
  template: `
<mat-card appearance="outlined" class="rt-mission-card">
  <mat-card-header>
    <mat-card-title>Entry layout</mat-card-title>
    <mat-card-subtitle>How the Entry page looks for this mission. Every layout saves the same kind of entry.</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <mat-radio-group class="mission__layout-group" aria-label="Entry layout" [value]="layout"
      (change)="layoutChange.emit($event.value)" data-testid="entryLayoutGroup">
      @for (l of layouts; track l.id) {
      <mat-radio-button [value]="l.id" [attr.data-testid]="'entryLayout-' + l.id">
        <span class="mission__layout-label">{{ l.label }}</span>
        <span class="mission__layout-desc">{{ l.description }}</span>
      </mat-radio-button>
      }
    </mat-radio-group>
  </mat-card-content>
</mat-card>`,
  styles: [`
    :host { display: contents; }
    .mission__layout-group { display: flex; flex-direction: column; gap: 4px; }
    .mission__layout-label { display: block; font-weight: 500; }
    .mission__layout-desc { display: block; color: var(--mat-sys-on-surface-variant); font-size: 0.875rem; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionEntryLayoutComponent {
  @Input({ required: true }) layout: EntryLayout = 'full'
  @Output() layoutChange = new EventEmitter<EntryLayout>()
  readonly layouts = ENTRY_LAYOUTS
}
