import { Component, EventEmitter, OnInit, Output, ChangeDetectionStrategy } from '@angular/core'
import { RouterLink } from '@angular/router'

import { MissionReadinessService, OfflineBasemapService } from '../services'

/**
 * ADR D-32: the persistent readiness indicator, rendered once inside HeaderComponent so it
 * appears on every page. A colored dot rather than text/icon - the header strip is already
 * dense on a phone. Deliberately never reads as a permission gate: nothing here disables
 * Entry or any other action.
 *
 * The dot itself is a `routerLink` to /mission - a reasonable general-purpose fallback, and
 * where three of the six signals live anyway. The full six-item breakdown, each row its own
 * link straight to the section that fixes it (F29-21, 2026-08-30 - "each readiness line
 * links directly to the page+field that fixes it"), lives in HeaderComponent's own hover
 * panel now, not here - see that component's `readinessItems()` for the ported version of
 * what used to be this component's own `items` getter.
 */
@Component({
  selector: 'rangertrak-mission-readiness',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './mission-readiness.component.html',
  styleUrls: ['./mission-readiness.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionReadinessComponent implements OnInit {
  constructor(public readiness: MissionReadinessService, private offlineBasemap: OfflineBasemapService) { }

  ngOnInit(): void {
    // Re-checks the async signals (tiles saved, bundled map warmed, storage persisted) on
    // every page view - this component is instantiated fresh per page (PageComponent ->
    // HeaderComponent -> here), so this is effectively "refresh on navigation".
    this.readiness.refresh()
  }

  /**
   * Bug found live 2026-08-31 (maintainer, testing 0.90): on a touch device the dot's own
   * `routerLink="/mission"` hard-navigated away instead of joining the pill's unified
   * tap-to-toggle behavior, so the dot alone still acted like the OLD separate popup this
   * whole pass (see this file's own header comment) was supposed to have retired everywhere.
   * Root cause: HeaderComponent.onStatusClusterClick() deliberately ignores a click that
   * lands on `.readiness-dot` ("its own routerLink already handles those") - correct on
   * desktop (hover already reveals the panel; the click-through is a bonus shortcut), wrong
   * on touch (there is no hover there, so ignoring the dot's tap left it as the one element
   * in the pill that navigates instead of toggling).
   *
   * Fix: `isTouchOnly()` below drives the template's `[routerLink]` binding to `null` on
   * touch - `null` is RouterLink's own documented way to render an inert (non-navigating)
   * anchor, which is more reliable than trying to race `event.preventDefault()` against
   * RouterLink's own click handling (it does not consult `defaultPrevented`, so calling it
   * from a second listener on the same click cannot be trusted to stop the navigation).
   * `dotActivated` lets HeaderComponent fold the dot into its existing
   * `panelOpenOnTouch` toggle instead, so touch behaves identically everywhere in the pill.
   */
  @Output() readonly dotActivated = new EventEmitter<void>()
  readonly isTouchOnly = () => matchMedia('(hover: none)').matches

  onDotClick(): void {
    if (this.isTouchOnly()) {
      this.dotActivated.emit()
    }
    // Non-touch: nothing to do here - [routerLink]="/mission" (bound in the template) already
    // navigates on its own, unaffected, exactly as before this fix.
  }

  // Plain-text form, kept for the accessible name (aria-label) - a screen reader has no
  // use for the colored HTML breakdown below, and this is what the existing spec asserts
  // against.
  get tooltip(): string {
    const r = this.readiness
    const line = (ok: boolean, label: string) => `${ok ? '✓' : '✗'} ${label}`
    return [
      `Mission readiness: ${r.level()}`,
      line(r.missionNamed(), 'Mission named'),
      line(r.rosterLoaded(), 'Real roster loaded'),
      line(r.opPeriodCurrent(), 'Operating period current'),
      line(r.offlineTilesSaved(), 'Offline map tiles saved (Leaflet)'),
      line(r.bundledMapWarmed(), this.offlineBasemap.downloadProgress() === null
        ? 'Alternative map warmed (MapLibre)'
        : `Downloading offline world map… ${this.offlineBasemap.downloadProgress()}%`),
      line(r.storagePersisted(), 'Storage protected from eviction'),
    ].join('\n')
  }

  // Raised live 2026-08-30: the structured (route/fragment-linked) form of this breakdown
  // moved to HeaderComponent.readinessItems() - this dot is only ever used inside that
  // component's own pill now, and having both render their own competing hover panels was
  // the actual complaint. This getter stays for the plain-text tooltip/aria-label above.
}
