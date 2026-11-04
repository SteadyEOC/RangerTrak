import { MasonryDirective } from '../layout/masonry.directive'
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core'

import { MatIconModule } from '@angular/material/icon'
import { MatCardModule } from '@angular/material/card'
import { ExpandableSectionComponent } from '../expandable-section/expandable-section.component'
import { FieldModeService } from '../services/field-mode.service'

/**
 * The "Import, export & print" panel (E-187 Layers, ADR D-58 item 4): one collapsible block at
 * the bottom of Rangers - and, in phase B, Map - that holds the cards for bringing lists in,
 * handing them on and printing them.
 *
 * Deliberately page-agnostic: it knows nothing about rosters or places. A page projects its own
 * `<mat-card appearance="outlined" class="rt-mission-card rt-io-card">`s into it and they sit in
 * the one card grid, `.rt-card-grid` (E-210), with no second border around them.
 *
 * Shown whenever the device is not in field mode. `fieldModeGuard` already keeps a field phone
 * off both pages, so this is belt and braces and needs no setting of its own.
 */
@Component({
  selector: 'rangertrak-io-panel',
  standalone: true,
  imports: [ExpandableSectionComponent, MatIconModule, MatCardModule, MasonryDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './io-panel.component.html',
  styleUrls: ['./io-panel.component.scss'],
})
export class IoPanelComponent {
  protected readonly fieldMode = inject(FieldModeService)
  /** The bar's title and its right-hand line; a page may name its own (Map: "... places"). */
  readonly label = input('Import, export & print')
  readonly description = input('Bring lists in, hand them on, print them')
}
