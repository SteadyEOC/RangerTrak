import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"

const DISMISSED_KEY = 'entryWelcomeDismissed'

/**
 * E-83: Entry's first-run welcome panel, and the ability to bring it back after dismissing
 * it. A tiny shared, signal-backed dismissed flag (per-device via localStorage, same
 * pattern as ThemeService/StaleOriginNoticeComponent/RangersComponent's own dismiss flags)
 * rather than component-local state, because two unrelated components need it: Entry reads
 * it to decide whether to show the panel, HeaderComponent's status-cluster pill writes to
 * it to bring the panel back.
 */
@Injectable({ providedIn: 'root' })
export class WelcomePanelService {

  private id = 'Welcome Panel Service'

  readonly dismissed = signal(localStorage.getItem(DISMISSED_KEY) === 'true')

  /**
   * 2026-09-30, John ("I already have data, but am still seeing the page 1 top bar"): the
   * panel now shows by itself only on a brand-new device (EntryComponent.canLoadDemoData());
   * once there is data, its "first load your rangers" line is noise. Clicking the header
   * pill (show()) still brings it back on purpose - for this visit only, hence a plain
   * signal and not localStorage.
   */
  readonly reopened = signal(false)

  constructor(private log: LogService) { }

  dismiss(): void {
    localStorage.setItem(DISMISSED_KEY, 'true')
    this.dismissed.set(true)
    this.log.verbose('Welcome panel dismissed', this.id)
  }

  show(): void {
    localStorage.removeItem(DISMISSED_KEY)
    this.dismissed.set(false)
    this.reopened.set(true)
    this.log.verbose('Welcome panel reopened', this.id)
  }
}
