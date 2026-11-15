import { Injectable, signal } from '@angular/core'

/**
 * E-315: the one Full screen button, in the page header on every page. It used to live inside the
 * Map page only. A page may register the element that should fill the screen (the Map registers its
 * map area, so it behaves as before); every other page fills the screen with the whole document.
 *
 * Browsers with no Fullscreen API (iPhone) get a CSS fallback: the registered element is pinned
 * over the window (`.rt-pseudo-fullscreen`), or, for the whole page, the navbar and footer are
 * hidden (`html[data-fullscreen-fallback]`). Neither writes anything anywhere.
 */
@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private target: HTMLElement | null = null
  private pseudoOn: HTMLElement | null = null
  private readonly fullscreenSignal = signal(false)
  /** True while the browser (or the CSS fallback) has the page or its registered element full screen. */
  readonly isFullscreen = this.fullscreenSignal.asReadonly()

  constructor() {
    if (typeof document !== 'undefined') {
      // Keyed off the document's own state, so the browser's own exit paths (Esc) are caught too.
      document.addEventListener('fullscreenchange', () => this.fullscreenSignal.set(!!document.fullscreenElement || !!this.pseudoOn))
    }
  }

  /** A page registers the element that should fill the screen; null (on destroy) returns to the whole page. */
  setTarget(el: HTMLElement | null): void {
    if (el === null && this.pseudoOn) this.leavePseudo()
    this.target = el
  }

  /** Whether the Fullscreen API exists here (it does not on iPhone). */
  private get hasApi(): boolean {
    return typeof document !== 'undefined' && document.fullscreenEnabled === true
  }

  /** Enter full screen: `el`, else the registered element, else the whole document. Resolves false when refused. */
  async enter(el?: HTMLElement): Promise<boolean> {
    const element = el ?? this.target ?? document.documentElement
    if (!this.hasApi) {
      this.enterPseudo(element)
      return true
    }
    try {
      await element.requestFullscreen()
      return true
    } catch {
      return false
    }
  }

  async exit(): Promise<void> {
    if (this.pseudoOn) this.leavePseudo()
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    this.fullscreenSignal.set(false)
  }

  async toggle(): Promise<void> {
    if (document.fullscreenElement || this.pseudoOn) await this.exit()
    else await this.enter()
  }

  private enterPseudo(element: HTMLElement): void {
    if (element === document.documentElement) document.documentElement.setAttribute('data-fullscreen-fallback', '')
    else element.classList.add('rt-pseudo-fullscreen')
    this.pseudoOn = element
    this.fullscreenSignal.set(true)
  }

  private leavePseudo(): void {
    this.pseudoOn?.classList.remove('rt-pseudo-fullscreen')
    document.documentElement.removeAttribute('data-fullscreen-fallback')
    this.pseudoOn = null
    this.fullscreenSignal.set(!!document.fullscreenElement)
  }
}
