import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core'
import { NavigationEnd, Router } from '@angular/router'

import { FieldModeService } from './field-mode.service'
import { FullscreenService } from './fullscreen.service'

/** The URL parameter that makes a window a Display window: `?display=1`. */
export const DISPLAY_PARAM = 'display'

/** A page's own marking (E-314, Q75): how many rows it has selected, and how to clear them. */
export interface DisplayMarks {
  readonly count: Signal<number>
  readonly clear: () => void
}

/**
 * E-314 / ADR D-71: Display, a look-only state of ONE window. The Display button in the page
 * header turns it on; `?display=1` in the URL keeps it across a reload. It is deliberately NOT
 * stored anywhere (no localStorage, no sessionStorage, no backup, hand-over, Setup file or Report
 * Packet), it never touches the Easy/Full menus choice (`ViewService`, key `rt-view`), and it never
 * writes: the pages that show it hide every control that changes anything, and their grids stop
 * editing. It is offered only on the look-at pages (those that pass `displayable` to
 * `rangertrak-page`) and never in field mode.
 *
 * Marking (Q75): rows a person selects in Display point at things for the room. They live in the
 * page's own grid selection, in memory in this window, and are cleared on leaving Display.
 */
@Injectable({ providedIn: 'root' })
export class DisplayService {
  private readonly router = inject(Router)
  private readonly fullscreen = inject(FullscreenService)
  private readonly fieldMode = inject(FieldModeService)

  private readonly activeSignal = signal(typeof location !== 'undefined'
    && new URLSearchParams(location.search).get(DISPLAY_PARAM) === '1')
  /** True while this window is in Display. */
  readonly active = this.activeSignal.asReadonly()

  private readonly offeredBy = signal<object | null>(null)
  /** Whether the page on screen offers Display (and this is not a field phone). */
  readonly offered = computed(() => this.offeredBy() !== null && !this.fieldMode.enabled())

  private readonly marksSource = signal<DisplayMarks | null>(null)
  /** How many rows are marked on the page in view (0 when the page has no marking). */
  readonly markCount = computed(() => this.marksSource()?.count() ?? 0)

  private askedForFullscreen = false

  constructor() {
    // The one visible effect of Display on the document: pages and the shell key their CSS off it.
    effect(() => {
      if (this.activeSignal()) document.documentElement.setAttribute('data-display', '')
      else document.documentElement.removeAttribute('data-display')
    })
    this.router.events.subscribe(e => {
      if (e instanceof NavigationEnd) this.onNavigated()
    })
    document.addEventListener('keydown', e => this.onKeydown(e))
  }

  /** A displayable page announces itself on creation and withdraws on destruction. */
  register(page: object): void {
    // untracked: a page registers from ngOnChanges, i.e. while its parent's template is rendering.
    untracked(() => this.offeredBy.set(page))
  }

  unregister(page: object): void {
    untracked(() => { if (this.offeredBy() === page) this.offeredBy.set(null) })
  }

  setMarks(marks: DisplayMarks | null): void {
    untracked(() => this.marksSource.set(marks))
  }

  clearMarks(): void {
    this.marksSource()?.clear()
  }

  /** The Display button: the click is the user gesture that lets us ask for full screen. */
  async enter(): Promise<void> {
    if (!this.offered()) return
    this.activeSignal.set(true)
    this.syncUrl()
    this.askedForFullscreen = await this.fullscreen.enter(document.documentElement)
  }

  async exit(): Promise<void> {
    if (!this.activeSignal()) return
    this.clearMarks()
    this.activeSignal.set(false)
    this.syncUrl()
    if (this.askedForFullscreen) await this.fullscreen.exit()
    this.askedForFullscreen = false
  }

  toggle(): Promise<void> {
    return this.activeSignal() ? this.exit() : this.enter()
  }

  /** Keeps `?display=1` in the address bar in step with the state, without adding a history entry. */
  private syncUrl(): void {
    const has = this.router.parseUrl(this.router.url).queryParams[DISPLAY_PARAM] === '1'
    const want = this.activeSignal()
    if (has === want) return
    void this.router.navigate([], {
      queryParams: { [DISPLAY_PARAM]: want ? 1 : null }, queryParamsHandling: 'merge', replaceUrl: true,
    })
  }

  /** After a page change: leave Display on a page that does not offer it; keep the parameter on one that does. */
  private onNavigated(): void {
    // The page registers while it is created, which can be just after NavigationEnd.
    setTimeout(() => {
      if (!this.activeSignal()) return
      if (!this.offered()) void this.exit()
      else this.syncUrl()
    }, 0)
  }

  /** Esc leaves Display, unless the browser is full screen (its first Esc leaves that) or a field is being typed in. */
  private onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !this.activeSignal() || document.fullscreenElement || e.defaultPrevented) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    void this.exit()
  }
}
