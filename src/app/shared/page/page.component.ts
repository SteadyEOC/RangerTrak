import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Input, effect, inject } from '@angular/core'

import { HeaderComponent } from '../header/header.component'
import { FieldModeService } from '../services/field-mode.service'
import { ViewService } from '../services/view.service'

/**
 * The shell every routed page sits in.
 *
 * Before this, all eight routed pages opened with the same two lines -
 *
 *    <pageHeader [parentTitle]="title" [pageDescription]="pageDescr"></pageHeader>
 *    <section class="main">
 *
 * - and every one of them then defined `.main { margin: 0 1em }` in its own stylesheet.
 * Eight copies of a two-property rule, one of which had quietly drifted to
 * `margin: 0 0 0 1em`. That is the per-page duplication Sprint B exists to remove
 * (PRIVATE-Roadmap.md 19c).
 *
 * Usage:
 *    <rangertrak-page [title]="title" [description]="pageDescr">
 *      ...page content...
 *    </rangertrak-page>
 *
 * `showHeader` exists for Help, which is the one page with no mission strip of its own.
 *
 * `viewIds` (E-214): the Simple/Full view ids this page can hide (ADVANCED_FEATURES). When there
 * are any, the shell shows the "Full view" switch in the header row (E-231), except in field mode (which
 * has no view choice). Pages without hideable controls pass nothing.
 */
@Component({
  selector: 'rangertrak-page',
  standalone: true,
  imports: [CommonModule, HeaderComponent],
  templateUrl: './page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./page.component.scss']
})
export class PageComponent {
  @Input() title = ''
  @Input() description = ''
  @Input() showHeader = true
  @Input() viewIds: readonly string[] = []

  protected readonly fieldMode = inject(FieldModeService)
  private readonly view = inject(ViewService)
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  private readonly destroyRef = inject(DestroyRef)
  private observer: MutationObserver | null = null

  /**
   * Fade-in after Simple -> Full (E-214). For a few hundred ms after the switch, every element the
   * page newly renders gets the global `.rt-fade-in` class (styles/_patterns.scss), so only
   * controls that just appeared fade in - not the ones already on screen, not first load, not
   * navigation (the signal is only true right after the person's own switch). One observer here
   * serves all pages, instead of a rule in every template.
   */
  private readonly fadeNewControls = effect(() => {
    if (!this.view.justSwitchedToFull() || typeof MutationObserver === 'undefined') return
    this.observer?.disconnect()
    this.observer = new MutationObserver(records => {
      for (const r of records) {
        r.addedNodes.forEach(n => {
          if (n instanceof HTMLElement && !n.closest('rangertrak-view-switch')) n.classList.add('rt-fade-in')
        })
      }
    })
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true })
    setTimeout(() => this.observer?.disconnect(), 400)
  })

  constructor() {
    this.destroyRef.onDestroy(() => this.observer?.disconnect())
  }
}
