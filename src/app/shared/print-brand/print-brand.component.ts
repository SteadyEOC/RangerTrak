import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'

import { MissionService } from '../services'
import { printVersionLine } from '../build-stamp'
import {
  BRAND_URL, BRAND_URL_LABEL, MARK_ANTENNA, MARK_BODY, MARK_NAVY, MARK_PIN, MARK_SIGNAL, MARK_TIP, MARK_WAVES,
} from './rangertrak-mark'

/**
 * E-280 (John, 2026-11-07): the small RangerTrak mark, the version and RangerTrak.org, on every
 * printout - map sheet, ICS-309, roster, places, SitRep, After Action. (The ICS-213 and ICS-214
 * PDFs draw the same thing with pdf-lib: drawPrintBrand() in ics213-pdf.ts.)
 *
 * The mark is inline SVG, not an <img>, so it prints on a device that has never fetched the image.
 * It is aria-hidden and has no <title>: the text beside it already says RangerTrak, and a title
 * would also land in this element's textContent. Inherits its font size and colour from where it sits.
 */
@Component({
  selector: 'rangertrak-print-brand',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg class="print-brand__mark" viewBox="0 0 155 260" aria-hidden="true" focusable="false">
      <path [attr.d]="pin" fill="none" [attr.stroke]="navy" stroke-width="12" stroke-linejoin="round" />
      <path [attr.d]="antenna" fill="none" [attr.stroke]="navy" stroke-width="5" stroke-linecap="round" />
      <path [attr.d]="body" [attr.fill]="navy" />
      <path [attr.d]="tip" [attr.fill]="navy" />
      @for (w of waves; track $index) {
        <path [attr.d]="w" fill="none" [attr.stroke]="signal" stroke-width="9" stroke-linecap="round" />
      }
    </svg><span class="print-brand__text">{{ versionLine() }} &middot; <a [href]="url">{{ urlLabel }}</a></span>`,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 0.35em; vertical-align: middle; }
    .print-brand__mark { height: 1.9em; width: auto; flex: none; }
    a { color: inherit; text-decoration: none; }
  `],
})
export class PrintBrandComponent {
  private readonly missionService = inject(MissionService)

  readonly versionLine = computed(() => printVersionLine(this.missionService.settings?.version))
  readonly url = BRAND_URL
  readonly urlLabel = BRAND_URL_LABEL
  readonly navy = MARK_NAVY
  readonly signal = MARK_SIGNAL
  readonly pin = MARK_PIN
  readonly antenna = MARK_ANTENNA
  readonly body = MARK_BODY
  readonly tip = MARK_TIP
  readonly waves = MARK_WAVES
}
