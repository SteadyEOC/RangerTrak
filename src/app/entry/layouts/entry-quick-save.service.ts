import { Injectable, computed, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { map } from 'rxjs'
import { callerKind, type CallerResult } from '../../domain/caller-kind'
import { teamAtSave } from '../../domain/entry-team'
import { missionStationCall, newestFirst } from '../../domain/entry-layout'
import { resolveStationText } from '../../domain/ranger-match'
import { CallsignDirectoryService } from '../../shared/services/callsign-directory.service'
import {
  MissionService, OperatorNameService, RadioLogEntryType, RadioLogService, RangerService, undefinedLocation,
} from '../../shared/services/'
import type { LocationType } from '../../shared/services/'

export type QuickEntry = { from: string; to: string; message: string; date?: Date; location?: LocationType }

/**
 * E-332: the shared save step for the simpler Entry layouts (basic log and net). It builds the same entry the full
 * form builds (mergedFormValue() in EntryComponent: station resolution, From ranger's team, operator, source)
 * and hands it to the same RadioLogService.addRadioLogEntry(), which stamps id, uid, loggedAt and message number.
 */
@Injectable({ providedIn: 'root' })
export class EntryQuickSaveService {
  private readonly missions = inject(MissionService)
  private readonly rangerService = inject(RangerService)
  private readonly radioLog = inject(RadioLogService)
  private readonly directory = inject(CallsignDirectoryService)
  private readonly operatorName = inject(OperatorNameService)

  readonly mission = toSignal(this.missions.getMissionObserver(), { initialValue: this.missions.settings })
  private readonly rangers = toSignal(this.rangerService.getRangersObserver(), { initialValue: [] })
  /** A copy per emission: the service mutates one object in place, so the same reference would never notify. */
  private readonly log = toSignal(this.radioLog.getRadioLogObserver().pipe(map(l => ({ ...l }))))

  /** The scribe's name, shared with the full form and kept for the session (D-44). */
  readonly operator = this.operatorName.name
  /** The Sending as call chosen on the net layout; blank means the first option. In memory only, never stored in the mission. */
  readonly sendingAs = signal('')
  readonly stationCall = computed(() => missionStationCall(this.mission()))
  readonly tacticalNames = computed(() => (this.mission()?.tacticalCalls ?? []).map(t => t.name))
  /** The current operator's own call sign, from the roster, when the name matches a ranger. */
  readonly operatorCall = computed(() => {
    const name = this.operator().trim().toLowerCase()
    if (!name) return ''
    return this.rangers().find(r => r.fullName?.trim().toLowerCase() === name)?.callsign?.trim() ?? ''
  })
  /** The mission's last 200 saved entries, newest by time first (a backfilled entry sits at its own time). */
  readonly recent = computed<RadioLogEntryType[]>(() => newestFirst((this.log()?.logEntries ?? []).slice(-200)))
  /** The mission's default position: where "Add location" starts, as on the full form. */
  readonly defaultLocation = computed<LocationType>(() => {
    const m = this.mission()
    return { ...undefinedLocation, lat: m?.defLat ?? undefinedLocation.lat, lng: m?.defLng ?? undefinedLocation.lng }
  })

  /** The names the Entry boxes can offer: roster calls and tactical names. */
  readonly callOptions = computed(() => {
    const calls = this.rangers().map(r => r.callsign?.trim()).filter((c): c is string => !!c)
    return [...new Set([...this.tacticalNames(), ...calls])]
  })

  /** E-324: who is this caller (EOC, roster, tactical, call sign list)? Informs only; never blocks a save. */
  async hint(call: string): Promise<CallerResult | null> {
    const ctx = {
      eocCalls: this.mission()?.eocCalls ?? [],
      roster: this.rangers(),
      tacticalCalls: this.mission()?.tacticalCalls ?? [],
    }
    let result = callerKind(call, ctx)
    if (result.kind === 'blank') return null
    if (result.kind === 'unknown') {
      result = callerKind(call, { ...ctx, directoryHit: await this.directory.lookup(call) })
    }
    return result
  }

  /** Saves one entry; returns it. */
  save(e: QuickEntry): RadioLogEntryType {
    const m = this.mission()
    const rangers = this.rangers()
    const from = resolveStationText(e.from, m?.tacticalCalls ?? [], rangers)
    const to = resolveStationText(e.to, m?.tacticalCalls ?? [], rangers)
    const team = teamAtSave(from.rangerUid, rangers)
    const statuses = m?.radioLogStatuses ?? []
    const entry = {
      id: -1,
      location: e.location ?? undefinedLocation,
      date: e.date ?? new Date(),
      notes: e.message,
      source: 'Voice',
      generates213: false, replyRequested213: false, message213: '', recipients213: [], subject213: '',
      rangerUid: from.rangerUid,
      callsign: from.callsign,
      ...(from.tactical ? { tacticalCall: from.tactical } : {}),
      ...(team ? { team } : {}),
      ...(to.tactical ? { toTactical: to.tactical } : {}),
      ...(to.callsign ? { toCallsign: to.callsign } : {}),
      ...(to.rangerUid ? { toRangerUid: to.rangerUid } : {}),
      status: statuses[m?.defRadioLogStatus ?? 0]?.status ?? '',
      operator: this.operator().trim(),
      evidenceLocation: null,
      evidenceDirection: null,
    }
    return this.radioLog.addRadioLogEntry(JSON.stringify(entry))
  }
}
