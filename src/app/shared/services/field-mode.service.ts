import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"

const FIELD_MODE_KEY = 'fieldMode'

/**
 * E-114 §1a (2026-08-31, Private Roadmap.md): "lite mode" - a restricted device role for a
 * ranger's own phone (Entry + Help only, everything else hidden), distinct from the normal
 * full app a command-post/scribe device runs. A per-device configuration fact, not a role or
 * permission - same category as `commandPostEnabled` or a dismissed-notice flag
 * (`WelcomePanelService`, `RangersComponent.PRIVACY_DISMISSED_KEY`), deliberately NOT an
 * accounts/login system (D-40 forecloses that outright). Set once via the first-run prompt
 * (EntryComponent's welcome panel, gated by the same `canLoadDemoData()` "genuinely untouched
 * install" check the demo-data button already uses), never silently defaulted either way.
 * Since 2026-09-29 that prompt shows on phones and tablets only; laptops use Mission >
 * Advanced > Field phone (MissionAdvancedOptionsComponent), behind the same empty-device gate.
 */
@Injectable({ providedIn: 'root' })
export class FieldModeService {

  private id = 'Field Mode Service'

  readonly enabled = signal(localStorage.getItem(FIELD_MODE_KEY) === 'true')

  constructor(private log: LogService) { }

  enable(): void {
    localStorage.setItem(FIELD_MODE_KEY, 'true')
    this.enabled.set(true)
    this.log.warn('Field mode (lite mode) enabled on this device.', this.id)
  }

  /** Recommend only alongside a real reset, never a casual toggle - see E-114 §1a's own
   *  "not scoped further than this" note on why turning it back off deliberately has no UI
   *  affordance today. Exists for completeness/testability, not wired to any button yet. */
  disable(): void {
    localStorage.removeItem(FIELD_MODE_KEY)
    this.enabled.set(false)
    this.log.warn('Field mode (lite mode) disabled on this device.', this.id)
  }
}
