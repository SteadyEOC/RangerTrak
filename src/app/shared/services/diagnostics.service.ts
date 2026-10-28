import { Injectable, inject } from '@angular/core'

import { buildSuffix } from '../build-stamp'
import { redact } from '../redact'
import { FieldModeService } from './field-mode.service'
import { LogLevel, LogLevelNames } from './log.interface'
import { LogService } from './log.service'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'
import { StoragePersistenceService } from './storage-persistence.service'
import { ViewService } from './view.service'

/** Whole-report ceiling; the feedback form further trims to fit the Worker's 4000-character cap. */
export const DIAGNOSTICS_MAX_CHARS = 2500

/**
 * E-258 (2026-10-28): the opt-in diagnostic report attached to feedback. It goes into a PUBLIC
 * GitHub issue, so the rule is: environment facts, counts (never names), and the session log
 * with message text ONLY for Warn and Error entries (and only after redact()). Ordinary entries
 * contribute timestamp, level and source - their messages can name rangers or addresses.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {

  private log = inject(LogService)
  private mission = inject(MissionService)
  private view = inject(ViewService)
  private fieldMode = inject(FieldModeService)
  private persistence = inject(StoragePersistenceService)
  private rangers = inject(RangerService)
  private radioLog = inject(RadioLogService)
  private places = inject(MissionLocationService)

  async report(): Promise<string> {
    const lines: string[] = []
    const yn = (b: boolean | null | undefined) => b === null || b === undefined ? 'unknown' : b ? 'yes' : 'no'
    const safe = <T>(f: () => T): T | undefined => { try { return f() } catch { return undefined } }

    const version = safe(() => this.mission.settings?.version) ?? 'unknown'
    lines.push(`App: ${version}${buildSuffix()}`)
    lines.push(`Browser: ${navigator.userAgent}`)
    lines.push(`View: ${this.view.isSimple() ? 'Simple' : 'Full'}; field mode: ${this.fieldMode.enabled() ? 'on' : 'off'}`)
    lines.push(`Online: ${yn(navigator.onLine)}; installed app: ${yn(this.isStandalone())}`)

    let usage = ''
    try {
      const est = await navigator.storage?.estimate?.()
      if (est && est.usage !== undefined && est.quota !== undefined) {
        usage = `; used ${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576).toFixed(0)} MB`
      }
    } catch { /* leave it out */ }
    lines.push(`Storage protected: ${yn(this.persistence.persisted())}${usage}`)
    lines.push(`Service worker active: ${yn(!!navigator.serviceWorker?.controller)}`)

    const counts = [
      ['rangers', safe(() => this.rangers.rangers.length)],
      ['radio log entries', safe(() => this.radioLog.getCurrentRadioLog().logEntries.length)],
      ['places', safe(() => this.places.getCurrentLocations().length)],
    ].filter(([, n]) => n !== undefined).map(([k, n]) => `${n} ${k}`)
    if (counts.length) {
      lines.push(`Counts: ${counts.join(', ')}`)
    }

    const entries = this.log.entries()
    const stamp = (d: Date) => new Date(d).toISOString().slice(11, 19)
    const problems = entries.filter(e => e.level >= LogLevel.Warn).slice(-20)
    if (problems.length) {
      lines.push('', 'Problems this session (newest last):')
      for (const e of problems) {
        lines.push(`${stamp(e.date)} ${LogLevelNames[e.level]} ${e.source}: ${redact(String(e.msg)).slice(0, 300)}`)
      }
    }
    lines.push('', 'Recent activity (times and sources only):')
    for (const e of entries.slice(-30)) {
      lines.push(`${stamp(e.date)} ${LogLevelNames[e.level]} ${e.source}`)
    }

    const text = lines.join('\n')
    return text.length > DIAGNOSTICS_MAX_CHARS ? text.slice(0, DIAGNOSTICS_MAX_CHARS - 12) + '\n[trimmed]' : text
  }

  private isStandalone(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true
  }
}
