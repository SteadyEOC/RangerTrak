import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { formatDate } from '@angular/common'

import { MissionService } from '../services'
import { UsageStateService } from '../services/usage-state.service'
import { printVersionLine } from '../build-stamp'

/**
 * The heading of a list printed from the "Import, export & print" panel (E-187 Layers phase D,
 * ADR D-58): the mission, what the sheet is, when it was printed, and an EXERCISE or DEMO stamp
 * when the mission is one. Only ever drawn inside a print sheet, which is hidden on screen.
 */
@Component({
  selector: 'rangertrak-print-sheet-head',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <header class="sheet-head">
      <div class="sheet-head__line">
        <h1>{{ missionName() }}</h1>
        @if (stamp(); as s) {
          <span class="sheet-head__stamp" data-testid="print-sheet-stamp">{{ s }}</span>
        }
      </div>
      <p class="sheet-head__what"><strong>{{ title() }}</strong> &middot; {{ detail() }}</p>
      <p class="sheet-head__when">Printed {{ printedLabel() }}<span data-testid="print-sheet-version"> &middot; {{ versionLine() }}</span></p>
      @if (scenarioLine(); as sc) {
        <p class="sheet-head__when" data-testid="print-sheet-scenario">{{ sc }}</p>
      }
    </header>
  `,
  styles: [`
    .sheet-head { margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 1.5px solid #000; color: #000; }
    .sheet-head__line { display: flex; align-items: baseline; gap: 4mm; }
    h1 { margin: 0; font-size: 15pt; }
    .sheet-head__stamp { padding: 0 2mm; border: 1.5px solid #000; font-weight: 700; letter-spacing: .2em; font-size: 10pt; }
    p { margin: .8mm 0 0; font-size: 9pt; color: #000; }
    .sheet-head__when { color: #444; font-size: 8pt; }
  `],
})
export class PrintSheetHeadComponent {
  /** What the sheet is: "Contact sheet", "Places". */
  readonly title = input.required<string>()
  /** The counts or scope line under it. */
  readonly detail = input<string>('')
  /** When the print was started. */
  readonly printedAt = input<Date>(new Date())

  private readonly missionService = inject(MissionService)
  private readonly usage = inject(UsageStateService)

  readonly missionName = computed(() => {
    const m = this.missionService.settings
    return m?.event?.trim() || m?.mission?.trim() || 'RangerTrak'
  })
  readonly stamp = computed(() => {
    const mode = this.usage.mode()
    return mode === 'exercise' ? 'EXERCISE' : mode === 'demo' ? 'DEMO' : ''
  })
  /** E-196 (D-66): a second time line, only in Exercise mode with a scenario clock set. */
  readonly scenarioLine = computed(() => this.usage.scenarioLabelAt(this.printedAt()))
  /** E-280: which RangerTrak printed the sheet. */
  readonly versionLine = computed(() => printVersionLine(this.missionService.settings?.version))
  readonly printedLabel = computed(() => formatDate(this.printedAt(), 'MMM d, y, HH:mm', 'en-US'))
}
