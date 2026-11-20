import { Injectable, computed, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { map } from 'rxjs'
import { callerKind, type CallerResult } from '../../domain/caller-kind'
import { bandChoices } from '../../domain/band'
import { buildRadioLogEntry, missionDefaultLocation } from '../../domain/entry-build'
import { missionStationCall, newestFirst } from '../../domain/entry-layout'
import { CallsignDirectoryService } from '../../shared/services/callsign-directory.service'
import {
  MissionService, OperatorNameService, RadioLogEntryType, RadioLogService, RangerService, undefinedLocation,
} from '../../shared/services/'
import type { LocationType } from '../../shared/services/'

export type QuickEntry = { from: string; to: string; message: string; date?: Date; location?: LocationType; band?: string }

/**
 * E-332: the shared save step for the simpler Entry layouts (basic log and net). The entry is assembled by
 * domain/entry-build.ts (P1), whose stationFields() is the same station / team / operator block the full form's
 * mergedFormValue() in EntryComponent spreads, so the two cannot drift. The result goes to the same RadioLogService.addRadioLogEntry(), which stamps id, uid, loggedAt and message number.
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
  /**
   * E-327: the band last picked, on the net layout or the full form; it stays picked for the next entry, as in
   * George's Comm Register. In memory only, like the operator (D-44): blank after a reload.
   */
  readonly band = signal('')
  /** E-327: the mission's band list, plus the picked band if it has since been taken off the list. */
  readonly bandChoices = computed(() => bandChoices(this.mission()?.bands, this.band()))
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
    return missionDefaultLocation(this.mission(), undefinedLocation)
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
    const entry = buildRadioLogEntry(e, {
      mission: this.mission(), rangers: this.rangers(), operator: this.operator(), noLocation: undefinedLocation,
    })
    return this.radioLog.addRadioLogEntry(entry)
  }
}
