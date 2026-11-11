import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"
import {
  FieldReportMap, FieldReportState, foldSentUids, newEntries, parseFieldReports, receivedEntries,
  stateOf, unconfirmedEntries, withoutReports, withReceived, withSent,
} from "../../domain/field-report-state"

const FIELD_MODE_KEY = 'fieldMode'
// The older key (2026-10-28, a JSON array of uids): folded into REPORTS_KEY once, then removed.
const SENT_UIDS_KEY = 'fieldModeSentUids'
const REPORTS_KEY = 'fieldModeReports'

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

  /** 2026-10-28, John: which reports this phone has put in a Report Packet, so its header can say
   *  how many are "not sent yet". A share or download counts as sent: the app can't see what
   *  happens after the share sheet. Since 2026-11-11 (E-251/E-253, D-69) a uid maps to a record
   *  with three states (not sent / sent / received); see domain/field-report-state.ts. */
  readonly reports = signal<FieldReportMap>(this.loadReports())

  constructor(private log: LogService) { }

  /** Reads the map, folding in the old `fieldModeSentUids` list once (as "sent at an unknown time"). */
  private loadReports(): FieldReportMap {
    let map = parseFieldReports(localStorage.getItem(REPORTS_KEY))
    const old = localStorage.getItem(SENT_UIDS_KEY)
    if (old !== null) {
      map = foldSentUids(old, map)
      try {
        localStorage.setItem(REPORTS_KEY, JSON.stringify(map))
        localStorage.removeItem(SENT_UIDS_KEY)
      } catch { /* storage full or blocked: the in-memory map still works this session */ }
    }
    return map
  }

  private setReports(map: FieldReportMap): void {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(map))
    this.reports.set(map)
  }

  stateOf(uid: string | undefined): FieldReportState {
    return stateOf(this.reports(), uid)
  }

  /** The reports that have not been in a Report Packet yet. */
  newEntries<T extends { uid?: string }>(entries: readonly T[]): T[] {
    return newEntries(this.reports(), entries)
  }

  /** Sent, but no receipt or hand mark yet. */
  unconfirmedEntries<T extends { uid?: string }>(entries: readonly T[]): T[] {
    return unconfirmedEntries(this.reports(), entries)
  }

  receivedEntries<T extends { uid?: string }>(entries: readonly T[]): T[] {
    return receivedEntries(this.reports(), entries)
  }

  /** How many of these reports have not been in a Report Packet yet. */
  unsentCount(entries: readonly { uid?: string }[]): number {
    return this.newEntries(entries).length
  }

  markSent(uids: readonly string[], at: Date = new Date()): void {
    this.setReports(withSent(this.reports(), uids, at))
  }

  /** Returns how many changed; a received report stays received. Used by Part B (E-260) too. */
  markReceived(uids: readonly string[], at: Date = new Date(), msgNos?: ReadonlyMap<string, string>): number {
    const { map, changed } = withReceived(this.reports(), uids, at, msgNos)
    if (changed) this.setReports(map)
    return changed
  }

  forget(uids: readonly string[]): void {
    this.setReports(withoutReports(this.reports(), uids))
  }

  enable(): void {
    localStorage.setItem(FIELD_MODE_KEY, 'true')
    this.enabled.set(true)
    this.log.info('Turned field mode (lite mode) on for this device.', this.id)
  }

  /** E-142 (2026-09-29, John): the exit from field mode. Since 2026-10-28 (John) it is reached
   *  from the field phone's menu ("Leave field mode") as well as Help's "Turn off field mode",
   *  so the confirm and reload live here. Nav and route gating read enabled() at construction
   *  time, so a reload is the reliable reset (same as EntryComponent.onEnableFieldMode()). */
  confirmAndTurnOff(unsent: number): void {
    // 2026-10-28, John: leaving forgets which reports were sent, and a full-app packet names this
    // device's mission, so warn when some have not gone out yet and point at the Send button
    // (2026-11-11, John: name it as the button reads, "Send N new reports").
    const message = unsent
      ? `${unsent} report${unsent === 1 ? ' on this phone has' : 's on this phone have'} not been sent yet.\n\n`
        + `To send them first, choose Cancel, then Send ${unsent} new report${unsent === 1 ? '' : 's'} on Entry.\n\n`
        + 'Leave field mode anyway? The reports stay on this device.'
      : 'Turn off field mode on this device?\n\n'
        + 'Every page comes back to the menu: the roster, map, radio log and Mission. '
        + 'Reports already on this device stay.'
    if (!confirm(message)) {
      return
    }
    this.disable()
    window.location.reload()
  }

  disable(): void {
    localStorage.removeItem(FIELD_MODE_KEY)
    localStorage.removeItem(REPORTS_KEY)
    localStorage.removeItem(SENT_UIDS_KEY)
    this.enabled.set(false)
    this.log.info('Turned field mode (lite mode) off for this device.', this.id)
  }
}
