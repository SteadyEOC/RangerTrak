import { Directive, ElementRef, computed, effect, inject, input } from '@angular/core'

import { ViewService } from '../services/view.service'

/**
 * E-207 / ADR D-62 item 7: the one shared "Advanced" marker. Put `[rtAdvanced]="'some-id'"` on a
 * card or control that Easy menus can hide, and in Full menus it gets `.rt-advanced`
 * (styles/_patterns.scss: a thin left rule), so core and extra are visible at a glance.
 * It also gets the title and aria-description "Full menus option" (E-214). In Easy menus nothing is added. It never hides anything itself; that is
 * `ViewService.isShown()`.
 */
const HINT = 'Full menus option'

@Directive({
  selector: '[rtAdvanced]',
  host: { '[class.rt-advanced]': 'marked()', '[attr.aria-description]': 'marked() ? HINT : null' },
})
export class AdvancedDirective {
  /** The id in `ADVANCED_FEATURES` (domain/view.ts). */
  readonly rtAdvanced = input.required<string>()

  private readonly view = inject(ViewService)
  protected readonly marked = computed(() => this.view.isAdvanced(this.rtAdvanced()))
  protected readonly HINT = HINT

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef)
  private ownTitle = false

  // A title the host already has wins; ours is added and removed only when we put it there.
  private readonly titleFollowsMark = effect(() => {
    const host = this.el.nativeElement
    if (this.marked()) {
      if (!host.hasAttribute('title')) { host.setAttribute('title', HINT); this.ownTitle = true }
    } else if (this.ownTitle) {
      host.removeAttribute('title')
      this.ownTitle = false
    }
  })
}
