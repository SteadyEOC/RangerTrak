import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, HostListener, afterNextRender, signal
} from '@angular/core'

/**
 * E-57(3): a floating "back to top" control, shown only once the page is actually tall
 * enough and scrolled far enough to need one.
 *
 * Split out of E-57's other two asks (phone header/footer review, sidebars-vs-accordions)
 * deliberately - the roadmap flags this one as small, self-contained, and shippable on its
 * own, which the other two are not.
 *
 * Why a scroll listener rather than IntersectionObserver on a sentinel: this app is
 * zoneless, and either way the visibility state has to be a signal to reach the template.
 * A passive scroll listener reading scrollY is the smaller of the two, and there is no
 * sentinel element to place that would survive every page's own layout.
 */
@Component({
  selector: 'rangertrak-back-to-top',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './back-to-top.component.html',
  styleUrls: ['./back-to-top.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BackToTopComponent {

  /** Show once the user is a full viewport-height down - i.e. the top is genuinely gone. */
  private static readonly SHOW_AFTER_PX = 600

  /**
   * Live review, 2026-08-22: on a page whose total scroll room is only modestly more than
   * SHOW_AFTER_PX (a Reports/Rangers page with a realistic, not enormous, amount of data),
   * requiring both `scrolled > 600` and `scrollable > 600` left almost no scroll range where
   * the button could actually show - confirmed live by walking scrollY in 30px steps: with
   * scrollable=712, it was visible only for scrollY in (600, 712], a ~110px sliver right at
   * the very bottom. Scrolling up "just a tad" from there reliably dropped below 600 and
   * hid it - exactly the reported symptom ("only shows when the footer is visible, vanishes
   * if scrolled up 30px"). The floor below scales the threshold down for shorter pages
   * instead of using the same fixed 600px regardless of how much content there is.
   */
  private static readonly MIN_SCROLLABLE_PX = 300
  private static readonly SHOW_AFTER_FRACTION = 0.4

  // A signal, not a plain field: this is written from a DOM event listener, which in a
  // zoneless app has no guaranteed path back into change detection otherwise (Sprint G).
  visible = signal(false)

  // 2026-10-28 perf trace: update() reads scrollHeight, which forced a ~68 ms layout in the
  // middle of the first draw when it ran from ngOnInit. The read phase of afterNextRender
  // measures once the page has been drawn, alongside Angular's other layout reads.
  constructor() {
    afterNextRender({ read: () => this.update() })
  }

  // passive: the handler never calls preventDefault, and saying so lets the browser
  // scroll without waiting on it.
  @HostListener('window:scroll', [])
  onScroll(): void {
    this.update()
  }

  @HostListener('window:resize', [])
  onResize(): void {
    this.update()
  }

  private update(): void {
    const scrolled = window.scrollY || document.documentElement.scrollTop || 0
    // Also require the page to actually BE scrollable by a meaningful amount, so this
    // never appears on a short page that only moved a little because of a soft keyboard
    // or an expanded disclosure.
    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    if (scrollable < BackToTopComponent.MIN_SCROLLABLE_PX) {
      this.visible.set(false)
      return
    }
    // Scales down for shorter pages rather than always requiring the full 600px - see the
    // constants' own comment for the live-reported bug this replaced.
    const threshold = Math.min(
      BackToTopComponent.SHOW_AFTER_PX,
      scrollable * BackToTopComponent.SHOW_AFTER_FRACTION
    )
    this.visible.set(scrolled > threshold)
  }

  toTop(): void {
    // Honor a reduced-motion preference rather than always smooth-scrolling - the same
    // check help.component.ts already uses for its letter animation.
    const motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    window.scrollTo({ top: 0, behavior: motionOK ? 'smooth' : 'auto' })
  }
}
