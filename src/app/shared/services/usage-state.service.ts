import { Injectable, computed, signal } from '@angular/core'

import { UsageInputs, UsageState, deriveUsageState, effectiveMode } from '../../domain/usage-state'
import { clearActiveDemoScenario, demoRecord } from '../mapping/demo-map'
import { recordStore } from '../storage/record-store'
import { AarNoteService } from './aar-note.service'
import { MissionLocationService } from './mission-location.service'
import { FieldModeService } from './field-mode.service'
import { LogService } from './log.service'
import { MissionModeType, MissionType } from './mission.interface'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'

/** How often the time-based edges (a report aging past 12 h, an op period about to start)
 *  are re-checked when nothing else has changed. */
const REFRESH_MS = 15 * 60 * 1000

/**
 * E-168 (2026-10-01, John): the one place that answers "is this device in real use?" - the
 * Entry demo card, the header pill's mode icon, the quiet-when-live gates and the printed
 * EXERCISE banner all read this. It stores nothing: it gathers inputs the app already has and
 * hands them to the pure rule in domain/usage-state.ts. The one writer is setMode(), which
 * saves the operator's choice as the mission's `missionMode` field.
 */
@Injectable({ providedIn: 'root' })
export class UsageStateService {
  private id = 'Usage State Service'

  private readonly rangers = signal<readonly string[]>([])
  private readonly reports = signal<readonly { id: string, date: number }[]>([])
  private readonly settings = signal<MissionType | null>(null)
  private readonly now = signal(Date.now())
  /** Bumped when the demo marker may have changed (it lives in localStorage, not a signal). */
  private readonly demoTick = signal(0)

  private readonly inputs = computed<UsageInputs>(() => {
    this.demoTick()
    const s = this.settings()
    const record = demoRecord()
    return {
      explicitMode: s?.missionMode,
      rangerUids: this.rangers(),
      reports: this.reports(),
      missionName: s?.mission ?? '',
      opPeriodStart: s ? new Date(s.opPeriodStart).getTime() : NaN,
      opPeriodEnd: s ? new Date(s.opPeriodEnd).getTime() : NaN,
      demo: record
        ? { loadedAt: record.loadedAt ? Date.parse(record.loadedAt) : NaN, rangerUids: record.rangerUids, reportIds: record.reportIds }
        : null,
      fieldMode: this.fieldMode.enabled(),
    }
  })

  /** empty / demo / setup / live. */
  readonly state = computed<UsageState>(() => deriveUsageState(this.inputs(), this.now()))
  /** The mode in effect: the operator's choice, else demo when a demo is loaded, else undefined. */
  readonly mode = computed<MissionModeType | undefined>(() => effectiveMode(this.inputs()))
  /** True when the app should stay out of the way (first-run tips, install prompt, ...). */
  readonly quiet = computed(() => this.state() === 'live')

  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private radioLogService: RadioLogService,
    private locationService: MissionLocationService,
    private aarNoteService: AarNoteService,
    private fieldMode: FieldModeService,
    private log: LogService,
  ) {
    this.missionService.getMissionObserver().subscribe({
      next: s => this.settings.set(s),
      error: e => this.log.error(`Settings subscription error: ${e}`, this.id),
    })
    this.rangerService.getRangersObserver().subscribe({
      next: rangers => { this.rangers.set(rangers.map(r => r.uid ?? '')); this.demoTick.update(n => n + 1) },
      error: e => this.log.error(`Rangers subscription error: ${e}`, this.id),
    })
    this.radioLogService.getRadioLogObserver().subscribe({
      next: log => {
        this.reports.set((log.logEntries ?? []).map(e => ({ id: String(e.id), date: new Date(e.date).getTime() })))
        this.demoTick.update(n => n + 1)
      },
      error: e => this.log.error(`Radio log subscription error: ${e}`, this.id),
    })
    setInterval(() => this.now.set(Date.now()), REFRESH_MS)
  }

  /**
   * "Start a real mission": clears the demo (roster, radio log entries, locations, after-action
   * notes, settings back to defaults) rather than relabelling demo data as real, then records the
   * chosen mode, if any. Destructive: the caller confirms first and reloads after it resolves,
   * as for loading a demo.
   */
  async startRealMission(mode?: MissionModeType): Promise<void> {
    this.rangerService.deleteAllRangers()
    this.radioLogService.deleteAllRadioLogEntries()
    this.locationService.deleteAllLocations()
    this.aarNoteService.deleteAllNotes()
    this.missionService.ResetDefaults()
    clearActiveDemoScenario()
    if (mode) this.setMode(mode)
    this.log.warn(`Started a real mission (demo data cleared)${mode ? `, mode ${mode}` : ''}.`, this.id)
    await recordStore.flush()
  }

  /** The operator's choice, saved on the mission so a restored backup keeps it. */
  setMode(mode: MissionModeType | undefined): void {
    this.missionService.updateMission({ ...this.missionService.settings, missionMode: mode })
    this.log.warn(`Mission mode set to ${mode ?? 'not chosen'}.`, this.id)
  }
}
