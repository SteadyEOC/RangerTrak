import { Subscription } from 'rxjs'

import { Injectable } from '@angular/core'

import { LogService } from './log.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { MissionType } from './mission.interface'
import { RadioLogType } from './radio-log-entry.interface'

/**
 * E-87 Stage 1 (2026-08-31) - the PWA-side half of "Command Post Server: serving the mission
 * to nearby devices" (`E-87 Command Post Server.md` in the private docs). Opt-in: when a
 * mission turns on `commandPostEnabled` and names a `commandPostServerUrl`, this POSTs a
 * redacted snapshot of the radio log there every time it changes, so `tools/command-post-
 * server.js`'s `/view` page has something current to show teams reading over the CP's WiFi.
 *
 * Design constraints straight from the scoping doc's §2.2/§2.3:
 * - **The PWA is authoritative and pushes; the server is a dumb read-only mirror.** No sync,
 *   no conflict resolution, no identity - one writer, many readers, matching the read-only
 *   need the 2026-08-15 exercise actually validated.
 * - **Degrades safely.** The command post server is a separate OS process on a separate
 *   origin that may not be running at all - a failed POST is caught and logged at `warn`,
 *   never `error` (a CP server not running is the NORMAL state for most missions, not a
 *   bug - same "don't log a false alarm for an expected state" lesson this app's own
 *   2026-08-31 log-noise audit already applied elsewhere, e.g. entry.component.ts's
 *   callsignCtrlChanged fix). The standalone PWA is byte-for-byte unaffected either way.
 * - **The roster never goes over the wire.** §4 point 1's own recommendation, followed
 *   directly here rather than left as an open question: `buildPayload()` sends reports and
 *   mission info only - never `RangerService.rangers`. A report's own `callsign` (already
 *   denormalized onto every `RadioLogEntryType` - "the primary evidence of who reported",
 *   see that field's own comment) is what identifies who's on the map; full names, phone
 *   numbers and photos stay on the scribe's device, never published onto what may be an open
 *   hotspot with unknown devices in range (ADR D-35).
 * - **No join code/trust model for this v1** (the scoping doc's §4 point 2, left open there)
 *   - the WiFi/hotspot's own password is the access boundary for now: anyone who can join the
 *   command post's network can already reach `serve-dist.js`'s existing static assets on the
 *   same LAN today, so this doesn't lower the bar further. A shared join code is a reasonable
 *   fast-follow if a mission's threat model calls for it, not built here.
 */

/** What actually gets published - deliberately NOT `MissionExport` (see this file's own
 *  header comment on why the roster is excluded, and `E-87 Command Post Server.md` §4.1 on
 *  why this needs to be its own shape rather than a flag on the existing export). */
export type CommandPostReport = {
  id: number
  callsign: string
  // E-165: tactical call and the To station, as recorded on the entry. Names and FCC call signs
  // only - the roster links (rangerUid/toRangerUid) stay on the device, like the roster itself.
  tacticalCall: string
  toTactical: string
  toCallsign: string
  date: string
  status: string
  source: string
  notes: string
  location: { lat: number; lng: number; address: string } | null
}

export type CommandPostMission = {
  publishedAt: string
  mission: string
  event: string
  opPeriod: string
  opPeriodStart: string
  opPeriodEnd: string
  reports: CommandPostReport[]
}

@Injectable({ providedIn: 'root' })
export class CommandPostPublishService {

  private id = 'Command Post Publish Service'
  private settings: MissionType | undefined

  private missionSubscription!: Subscription
  private radioLogSubscription!: Subscription

  constructor(
    private missionService: MissionService,
    private radioLogService: RadioLogService,
    private log: LogService,
  ) {
    // Cached, not read fresh per publish: the radio-log subscription (below) is what
    // actually drives each publish attempt, and it needs to know the CURRENT settings at
    // that moment without waiting on a second async source.
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => { this.settings = newMission },
      error: (e) => this.log.error(`Mission subscription error: ${e}`, this.id),
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (radioLog) => this.publish(radioLog),
      error: (e) => this.log.error(`Radio log subscription error: ${e}`, this.id),
    })
  }

  private publish(radioLog: RadioLogType): void {
    const settings = this.settings
    if (!settings?.commandPostEnabled) {
      return
    }
    const base = settings.commandPostServerUrl?.trim().replace(/\/+$/, '')
    if (!base) {
      return
    }

    const payload = this.buildPayload(settings, radioLog)

    fetch(`${base}/api/mission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          this.log.warn(`Command Post publish rejected (HTTP ${res.status}) by ${base}.`, this.id)
        }
      })
      // Expected/normal, not an error: the CP server is a separate process a mission may
      // simply not have running yet (or ever). See this file's own header comment.
      .catch((e) => this.log.warn(`Command Post publish failed - is the server running at ${base}? (${e})`, this.id))
  }

  private buildPayload(settings: MissionType, radioLog: RadioLogType): CommandPostMission {
    return {
      publishedAt: new Date().toISOString(),
      mission: settings.mission,
      event: settings.event,
      opPeriod: settings.opPeriod,
      opPeriodStart: new Date(settings.opPeriodStart).toISOString(),
      opPeriodEnd: new Date(settings.opPeriodEnd).toISOString(),
      reports: radioLog.logEntries.map((r): CommandPostReport => ({
        id: r.id,
        callsign: r.callsign,
        tacticalCall: r.tacticalCall ?? '',
        toTactical: r.toTactical ?? '',
        toCallsign: r.toCallsign ?? '',
        date: new Date(r.date).toISOString(),
        status: r.status,
        source: r.source ?? '',
        notes: r.notes,
        location: (r.location?.lat && r.location?.lng)
          ? { lat: r.location.lat, lng: r.location.lng, address: r.location.address ?? '' }
          : null,
      })),
    }
  }
}
