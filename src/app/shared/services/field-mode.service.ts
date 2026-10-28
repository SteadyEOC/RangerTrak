import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"

const FIELD_MODE_KEY = 'fieldMode'
const SENT_UIDS_KEY = 'fieldModeSentUids'

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

  /** 2026-10-28, John: the uids of the reports this phone has put in a Report Packet, so its
   *  header can say how many are "not sent yet". A share or download counts as sent: the app
   *  can't see what happens after the share sheet. */
  readonly sentUids = signal<ReadonlySet<string>>(FieldModeService.readSent())

  constructor(private log: LogService) { }

  private static readSent(): ReadonlySet<string> {
    try {
      const raw = JSON.parse(localStorage.getItem(SENT_UIDS_KEY) ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter(u => typeof u === 'string') : [])
    } catch {
      return new Set()
    }
  }

  markSent(uids: readonly string[]): void {
    const next = new Set([...this.sentUids(), ...uids])
    localStorage.setItem(SENT_UIDS_KEY, JSON.stringify([...next]))
    this.sentUids.set(next)
  }

  enable(): void {
    localStorage.setItem(FIELD_MODE_KEY, 'true')
    this.enabled.set(true)
    this.log.info('Turned field mode (lite mode) on for this device.', this.id)
  }

  /** E-142 (2026-09-29, John): wired to Help's "Turn off field mode" button
   *  (HelpStartComponent.onTurnOffFieldMode()), which confirms first and reloads after. */
  disable(): void {
    localStorage.removeItem(FIELD_MODE_KEY)
    localStorage.removeItem(SENT_UIDS_KEY)
    this.enabled.set(false)
    this.log.info('Turned field mode (lite mode) off for this device.', this.id)
  }
}
