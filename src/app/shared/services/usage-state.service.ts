import { Injectable, computed, effect, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { MatDialog } from '@angular/material/dialog'

import { ScenarioClock, readScenarioClock, scenarioInstantFromLocal, scenarioLabelAt, scenarioOffsetExplanation } from '../../domain/scenario'
import { ClearContext, ClearCounts, ClearId, DEFAULT_REPLACE_CLEAR, buildClearRows, clearedPlain, countNotes, noteMatcher } from '../../domain/clear-choices'
import { UsageInputs, UsageState, deriveUsageState, effectiveMode } from '../../domain/usage-state'
import { setQuiet } from '../quiet-flag'
import { clearActiveDemoScenario, demoRecord } from '../mapping/demo-map'
import { recordStore } from '../storage/record-store'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { AttachmentStoreService } from './attachment-store.service'
import { MissionLocationService } from './mission-location.service'
import { FieldModeService } from './field-mode.service'
import { LogService } from './log.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionModeType, MissionType } from '../../domain/model/mission.interface'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerPhotoService } from './ranger-photo.service'
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

  /**
   * E-168 (2026-10-01, John): the three modes - icon, short label for the panel, the spoken
   * label for the tooltip and aria-label, and one line of explanation. The stored codes
   * ('demo' | 'exercise' | 'incident') never change; these words can. Icons are Material
   * Icons already in the font: science (a trial), fitness_center (a drill), emergency (the
   * real thing).
   */
  readonly modes: ReadonlyArray<{ id: MissionModeType, label: string, aria: string, icon: string, blurb: string }> = [
    { id: 'demo', label: 'Demo', aria: 'Demo mode', icon: 'science', blurb: 'Made-up data, for trying the app.' },
    { id: 'exercise', label: 'Exercise', aria: 'Exercise', icon: 'fitness_center', blurb: 'A drill. Printouts are marked EXERCISE.' },
    { id: 'incident', label: 'Incident', aria: 'Real incident', icon: 'emergency', blurb: 'A real event.' },
  ]

  /** empty / demo / setup / live. */
  readonly state = computed<UsageState>(() => deriveUsageState(this.inputs(), this.now()))
  /** The mode in effect: the operator's choice, else demo when a demo is loaded, else undefined. */
  readonly mode = computed<MissionModeType>(() => effectiveMode(this.inputs()))
  /** The mode in effect, with its labels; null while none is chosen and no demo is loaded. */
  readonly modeInfo = computed(() => this.modes.find(m => m.id === this.mode()) ?? null)
  /** E-196 (D-66): the scenario clock, only while the mode is Exercise; undefined otherwise. Read
   *  through the tolerant reader, so a bad stored value is simply "off". */
  readonly scenarioClock = computed<ScenarioClock | undefined>(() =>
    this.mode() === 'exercise' ? readScenarioClock(this.settings()?.scenarioClock) : undefined)
  /** E-196 (D-66): "Scenario 14 Jan 14:12" at the given real moment, or '' when the clock is off
   *  (not Exercise mode, or none set). The one call every read-out and print line uses. */
  scenarioLabelAt(real: Date | number): string {
    return scenarioLabelAt(this.scenarioClock(), real instanceof Date ? real.getTime() : real)
  }

  /** The hover text that explains the offset, or ''. */
  scenarioHintAt(real: Date | number): string {
    const clock = this.scenarioClock()
    return clock ? scenarioOffsetExplanation(clock, real instanceof Date ? real.getTime() : real) : ''
  }

  /** E-319: the op period has ended, the log has entries and this is not a demo: Entry offers "Start the next mission". */
  readonly nextMissionOffer = computed(() => {
    const i = this.inputs()
    return this.state() !== 'demo' && i.reports.length > 0 && Number.isFinite(i.opPeriodEnd) && i.opPeriodEnd < this.now()
  })

  /** True when the app should stay out of the way (first-run tips, install prompt, ...). */
  readonly quiet = computed(() => this.state() === 'live')

  private router = inject(Router)
  private attachmentStore = inject(AttachmentStoreService)
  private rangerPhotoService = inject(RangerPhotoService)
  private dialog = inject(MatDialog)
  private journal = inject(MissionJournalService)

  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private radioLogService: RadioLogService,
    private locationService: MissionLocationService,
    private aarNoteService: AarNoteService,
    private activityLogHeaderService: ActivityLogHeaderService,
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
    // Plain-function interruptions (the first-print tip) read the flag, not this service.
    effect(() => setQuiet(this.quiet()))
    // The printed EXERCISE banner (styles.scss) keys off this class.
    effect(() => document.body.classList.toggle('rt-exercise', this.mode() === 'exercise'))
  }

  /**
   * E-221: the live counts the "What to clear" dialog shows, from the services that hold the data.
   * Notes and 214 lines are counted apart, as on the Restore preview.
   */
  clearCounts(): ClearCounts {
    return {
      rangers: this.rangerService.rangers.length,
      photos: this.rangerPhotoService.count(),
      entries: this.radioLogService.getCurrentRadioLog().logEntries.length,
      places: this.locationService.getCurrentLocations().length,
      tacticalCalls: this.missionService.settings.tacticalCalls?.length ?? 0,
      missionMode: this.missionService.settings.missionMode,
      ...countNotes(this.aarNoteService.getCurrentNotes()),
    }
  }

  /**
   * E-221: asks what to clear before an action that replaces or empties the mission (Load a demo,
   * Start a real mission, leaving Demo, Clear radio log). Returns the ids to clear (the locked rows
   * plus the ticked ones), or null if the operator cancelled. In a live mission the dialog carries
   * E-168's guard. The dialog is loaded when first needed.
   */
  async chooseWhatToClear(context: ClearContext, title: string, confirmLabel: string): Promise<ReadonlySet<ClearId> | null> {
    const attachmentNote = await this.attachmentStore.deletionNotice([])
    const { ClearDialogComponent } = await import('../clear-dialog/clear-dialog.component')
    const ref = this.dialog.open(ClearDialogComponent, {
      width: '36rem', maxWidth: '95vw',
      data: {
        title, confirmLabel, context, attachmentNote,
        rows: buildClearRows(context, this.clearCounts()),
        live: this.state() === 'live',
        missionName: this.missionService.settings.mission,
      },
    })
    return (await new Promise<ReadonlySet<ClearId> | null | undefined>(resolve => ref.afterClosed().subscribe(r => resolve(r)))) ?? null
  }

  /**
   * "Start a real mission": clears the demo (roster, ranger photos, radio log entries, locations,
   * settings back to defaults) rather than relabelling demo data as real, then records the chosen
   * mode, if any. E-221: the notes, 214 lines and 214 header go only when `clear` names them
   * (default: the incident notes, lines and header; RangerTrak notes stay). Destructive: the
   * caller confirms first and reloads after it resolves, as for loading a demo.
   */
  async startRealMission(mode?: MissionModeType, clear: ReadonlySet<ClearId> = DEFAULT_REPLACE_CLEAR): Promise<void> {
    const counts = this.clearCounts()   // E-223: for the log, taken before anything goes
    this.rangerService.deleteAllRangers()
    await this.rangerPhotoService.clear()   // keyed by callsign: real photos must not outlive the roster
    await this.radioLogService.deleteAllRadioLogEntries()
    this.locationService.deleteAllLocations()
    this.aarNoteService.deleteWhere(noteMatcher(clear))
    if (clear.has('header')) this.activityLogHeaderService.clear()
    this.missionService.ResetDefaults()   // initMission() omits scenarioClock, so a real mission starts without one (D-66)
    clearActiveDemoScenario()
    if (mode) this.applyMode(mode)
    this.journal.record('real-mission-started',
      `Started a real mission${mode ? ` in ${mode} mode` : ''}. ${clearedPlain('replace', clear, counts)}`)
    await recordStore.flush()
  }

  /**
   * E-319 "Start the next mission": after a real mission, clears what the operator chose so the device is
   * ready for the next one. The radio log and the mission's name, event and op period always go; the roster
   * (and so its photos), places, tactical call signs, mission mode, notes and 214 header go only when `clear`
   * names them. Every other mission setting (map, coordinate formats, statuses, geocoding key, default
   * position, station letter) stays: unlike startRealMission this never calls ResetDefaults(). The caller
   * confirms first (chooseWhatToClear('next', ...)) and reloads after it resolves.
   */
  async startNextMission(clear: ReadonlySet<ClearId>): Promise<void> {
    const counts = this.clearCounts()   // E-223: for the log, taken before anything goes
    await this.radioLogService.deleteAllRadioLogEntries()
    if (clear.has('roster')) {
      this.rangerService.deleteAllRangers()
      await this.rangerPhotoService.clear()   // keyed by call sign: photos never outlive the roster
    }
    if (clear.has('places')) this.locationService.deleteAllLocations()
    this.aarNoteService.deleteWhere(noteMatcher(clear))
    if (clear.has('header')) this.activityLogHeaderService.clear()
    const fresh = this.missionService.initMission()
    const next: MissionType = {
      ...this.missionService.settings,
      mission: fresh.mission,
      event: fresh.event,
      eventNotes: fresh.eventNotes,
      opPeriod: fresh.opPeriod,
      opPeriodStart: fresh.opPeriodStart,
      opPeriodEnd: fresh.opPeriodEnd,
    }
    delete next.scenarioClock   // D-66: a new mission starts without a scenario clock
    if (clear.has('tactical')) next.tacticalCalls = []
    if (clear.has('mode')) next.missionMode = undefined
    this.missionService.updateMission(next)
    this.journal.record('next-mission-started', `Started the next mission. ${clearedPlain('next', clear, counts)}`)
    await recordStore.flush()
  }

  /** Demo data is never relabelled as real: leaving Demo for Exercise or Incident offers to
   *  clear the demo and start a real mission instead. Anything else just records the choice. */
  async pickMode(mode: MissionModeType): Promise<void> {
    if (mode === this.mode()) return
    // Demo mode only comes from loading a demo (it replaces the mission). 2026-10-02 this
    // explained the way in an alert; 2026-10-05, John: take the scribe there instead - Mission,
    // Danger zone opened, focus on the demo picker (mission-advanced-options, #demo). The
    // picker's own confirm is the guard; nothing is replaced by this click.
    if (mode === 'demo') {
      void this.router.navigate(['/mission'], { fragment: 'demo' })
      return
    }
    if (this.mode() === 'demo') {
      // 2026-10-05, John: "I clicked Exercise and it asked whether to start a real mission" - the
      // question names the mode picked; "real" read as Incident.
      const start = mode === 'exercise' ? 'Leave the demo and start an exercise?' : 'Leave the demo and start a real incident?'
      const clear = await this.chooseWhatToClear('replace', start, mode === 'exercise' ? 'Start exercise' : 'Start incident')
      if (!clear) return
      this.journal.record('demo-left', `Left Demo mode for ${mode} mode.`)
      await this.startRealMission(mode, clear)
      window.location.reload()
      return
    }
    this.setMode(mode)
  }

  /** The operator's choice, saved on the mission so a restored backup keeps it. */
  setMode(mode: MissionModeType | undefined): void {
    this.applyMode(mode)
    this.journal.record('mode-changed', `Set the mission mode to ${mode ?? 'not chosen'}.`)
  }

  /** Saves the mode without a journal entry, for callers that record a bigger action themselves. */
  private applyMode(mode: MissionModeType | undefined): void {
    // D-66: the scenario clock only means something in Exercise mode, so any other mode clears it.
    const next = { ...this.missionService.settings, missionMode: mode }
    if (mode !== 'exercise') delete next.scenarioClock
    this.missionService.updateMission(next)
  }

  /** E-196 (D-66): "the scenario stands at `scenarioLocal` right now" (a date and time as picked,
   *  read as the scenario's own wall clock). Saved as { realAt: now, scenarioAt }. */
  setScenarioClock(scenarioLocal: Date, nowMs = Date.now()): ScenarioClock {
    const clock: ScenarioClock = { realAt: new Date(nowMs).toISOString(), scenarioAt: scenarioInstantFromLocal(scenarioLocal) }
    this.saveScenarioClock(clock)
    return clock
  }

  /** Saves a clock that is already in stored form (from a catch-up file). */
  saveScenarioClock(clock: ScenarioClock): void {
    this.missionService.updateMission({ ...this.missionService.settings, scenarioClock: clock })
    this.journal.record('scenario-clock-set', `Set the scenario clock to ${clock.scenarioAt} (as of ${clock.realAt}).`)
  }

  clearScenarioClock(): void {
    const next = { ...this.missionService.settings }
    delete next.scenarioClock
    this.missionService.updateMission(next)
  }
}
