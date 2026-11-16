import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core'
import { NavigationEnd, Router } from '@angular/router'

import { FieldModeService } from './field-mode.service'
import { FullscreenService } from './fullscreen.service'
import { POPOUT_PARAM, isReadOnlyWindow } from '../storage/read-only-window'

/** The URL parameter that makes a window a Display window: `?display=1`. */
export const DISPLAY_PARAM = 'display'

/** E-313: what a pop-out's window title starts with, so several windows can be told apart in the taskbar. */
export const POPOUT_TITLE_PREFIX = 'Pop out - '

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
 * E-313: a read-only window (a pop-out, or the blocked-tab gate's read-only view; `?popout=1`) is always
 * in Display and cannot leave it: "Exit display" becomes "Close window", Esc does nothing, and a
 * page that is not a look-at page is replaced by the Map. See storage/read-only-window.ts.
 *
 * Marking (Q75): rows a person selects in Display point at things for the room. They live in the
 * page's own grid selection, in memory in this window, and are cleared on leaving Display.
 */
@Injectable({ providedIn: 'root' })
export class DisplayService {
  private readonly router = inject(Router)
  private readonly fullscreen = inject(FullscreenService)
  private readonly fieldMode = inject(FieldModeService)

  /** E-313: true in a read-only window (a pop-out). Never changes during the window's life. */
  readonly readOnly = isReadOnlyWindow()

  private readonly activeSignal = signal(this.readOnly || (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get(DISPLAY_PARAM) === '1'))
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
    if (!this.offered() || this.readOnly) return
    this.activeSignal.set(true)
    this.syncUrl()
    this.askedForFullscreen = await this.fullscreen.enter(document.documentElement)
  }

  async exit(): Promise<void> {
    if (!this.activeSignal() || this.readOnly) return
    this.clearMarks()
    this.activeSignal.set(false)
    this.syncUrl()
    if (this.askedForFullscreen) await this.fullscreen.exit()
    this.askedForFullscreen = false
  }

  toggle(): Promise<void> {
    return this.activeSignal() ? this.exit() : this.enter()
  }

  /** E-313: the "Close window" button of a read-only window. */
  closeWindow(): void {
    window.close()
    // A tab the person opened themselves (the blocked-tab gate's read-only view) cannot close itself:
    // after a moment, go back to the app's own address instead, so the button is never a dead end.
    setTimeout(() => location.assign(new URL('.', document.baseURI).toString()), 300)
  }

  /** Keeps `?display=1` (and, in a read-only window, `?popout=1`) in the address bar in step with the state, without adding a history entry. */
  private syncUrl(): void {
    const params = this.router.parseUrl(this.router.url).queryParams
    const want = this.activeSignal()
    const wantPopOut = this.readOnly
    if ((params[DISPLAY_PARAM] === '1') === want && (params[POPOUT_PARAM] === '1') === wantPopOut) return
    void this.router.navigate([], {
      queryParams: { [DISPLAY_PARAM]: want ? 1 : null, [POPOUT_PARAM]: wantPopOut ? 1 : null },
      queryParamsHandling: 'merge', replaceUrl: true,
    })
  }

  /** After a page change: leave Display on a page that does not offer it; keep the parameter on one that does. */
  private onNavigated(): void {
    // The page registers while it is created, which can be just after NavigationEnd.
    setTimeout(() => {
      if (this.readOnly) {
        // E-313: a pop-out is only ever one of the look-at pages, tagged so the taskbar tells them apart.
        if (!document.title.startsWith(POPOUT_TITLE_PREFIX)) document.title = POPOUT_TITLE_PREFIX + document.title
        // A page that registers late is given a moment before it counts as "not a look-at page".
        setTimeout(() => {
          if (!this.offered()) void this.router.navigate(['/map'], { queryParams: { [DISPLAY_PARAM]: 1, [POPOUT_PARAM]: 1 }, replaceUrl: true })
          else this.syncUrl()
        }, 400)
        return
      }
      if (!this.activeSignal()) return
      if (!this.offered()) void this.exit()
      else this.syncUrl()
    }, 0)
  }

  /** Esc leaves Display, unless the browser is full screen (its first Esc leaves that) or a field is being typed in. */
  private onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !this.activeSignal() || this.readOnly || document.fullscreenElement || e.defaultPrevented) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    void this.exit()
  }
}
