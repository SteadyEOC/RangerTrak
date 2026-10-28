import { Injectable, computed, signal } from '@angular/core'

import { liveRefs } from '../../domain/attachments'
import { DEFAULT_LOCATION_TYPES, DEFAULT_RADIO_LOG_STATUSES, DEFAULT_RECIPIENT_OPTIONS_213 } from '../../domain/mission-migration'
import {
  AppView, ViewContext, ViewSource, applySuggestedView, initialView, isAdvanced as domainIsAdvanced, isShown as domainIsShown,
} from '../../domain/view'
import { FieldModeService } from './field-mode.service'
import { AarNoteService } from './aar-note.service'
import { LogService } from './log.service'
import { MissionLocationService } from './mission-location.service'
import { MissionType } from './mission.interface'
import { MissionService } from './mission.service'
import { RadioLogEntryType } from './radio-log-entry.interface'
import { RadioLogService } from './radio-log.service'
import { UsageStateService } from './usage-state.service'
import { RecordStore } from '../storage/record-store'

const VIEW_KEY = 'rt-view'
const VIEW_SOURCE_KEY = 'rt-view-source'

/** The source a stored view with no (or a garbled) source is treated as: the person's own. */
const FALLBACK_SOURCE: ViewSource = 'user'

/**
 * E-207 / ADR D-62 (2026-10-19, John): Simple view and Full view. A per-device setting kept in
 * localStorage like `FieldModeService`, deliberately NOT in the mission settings, backup,
 * hand-over or Report Packet - a scribe's laptop and a volunteer's phone in the same mission want
 * different views. Storage goes through a try/catch (it can throw in private browsing or with
 * site data blocked): a read that fails gives the default and a write is dropped, the safe
 * direction to fail in, as for `DevicePrefsService`.
 *
 * Two keys: `rt-view` ('simple' | 'full') and `rt-view-source` ('default' | 'upgrade' | 'setup'
 * | 'user'), which says who chose it so a Setup file's suggestion never overrides the person.
 *
 * Components never write their own condition: they ask `isShown('some-id')`, and the rules are
 * the single list in `domain/view.ts`. Hiding a control never clears or saves anything.
 */
@Injectable({ providedIn: 'root' })
export class ViewService {

  private id = 'View Service'

  private readonly viewSignal = signal<AppView>('simple')
  private readonly sourceSignal = signal<ViewSource>('default')

  /** The view in effect on this device. */
  readonly view = this.viewSignal.asReadonly()
  /** Who chose it (see the class comment). */
  readonly source = this.sourceSignal.asReadonly()
  readonly isSimple = computed(() => this.viewSignal() === 'simple')
  private readonly justSwitchedSignal = signal(false)
  /** True for a moment after the person switches Simple -> Full, so newly shown controls can fade in once. */
  readonly justSwitchedToFull = this.justSwitchedSignal.asReadonly()

  private readonly settings = signal<MissionType | null>(null)
  private readonly entries = signal<readonly RadioLogEntryType[]>([])
  private readonly locationCount = signal(0)
  private readonly activityLineCount = signal(0)

  /** What the rules look at, gathered from the services the app already has. */
  private readonly context = computed<ViewContext>(() => {
    const s = this.settings()
    const entries = this.entries()
    const defaults = this.missionService.initMission()
    return {
      statusesCustomised: !!s && !sameList(s.radioLogStatuses, DEFAULT_RADIO_LOG_STATUSES, ['status', 'color', 'icon']),
      locationCategoriesCustomised: !!s && !sameList(s.locationTypes, DEFAULT_LOCATION_TYPES, ['type', 'color', 'icon']),
      locationCount: this.locationCount(),
      mapSettingsCustomised: !!s && (!!s.googleGeocodingApiKey
        || JSON.stringify(s.leaflet) !== JSON.stringify(defaults.leaflet)
        || JSON.stringify(s.maplibre) !== JSON.stringify(defaults.maplibre)),
      recipientsCustomised: !!s && (!sameStrings(s.recipientOptions213, DEFAULT_RECIPIENT_OPTIONS_213)
        || !!s.autoPrint213 || s.extraCopies213 !== defaults.extraCopies213),
      tacticalCallCount: s?.tacticalCalls?.length ?? 0,
      boardInUse: !!s && (!!s.commandPostEnabled || !!s.commandPostServerUrl?.trim()),
      attachmentCount: entries.reduce((n, e) => n + liveRefs(e).length, 0),
      encryptionOn: this.recordStore.isEncryptionEnabled(),
      fieldMode: this.fieldMode.enabled(),
      nonDefaultSourceCount: entries.filter(e => !!e.source && e.source !== 'Voice').length,
      toStationCount: entries.filter(e => !!(e.toTactical || e.toCallsign || e.toRangerUid)).length,
      evidenceLocationCount: entries.filter(e => !!e.evidenceLocation).length,
      // Pages that know better (Rangers & Teams holds the layers) pass this in; see isShown().
      layerCount: 0,
      mapEngineIsAlternative: false,
      mapExtraLayersOn: false,
      setupFileAsked: false,
      activityLineCount: this.activityLineCount(),
    }
  })

  constructor(
    private missionService: MissionService,
    private radioLogService: RadioLogService,
    private locationService: MissionLocationService,
    private aarNoteService: AarNoteService,
    private fieldMode: FieldModeService,
    private usage: UsageStateService,
    private recordStore: RecordStore,
    private log: LogService,
  ) {
    this.missionService.getMissionObserver().subscribe({
      next: s => this.settings.set(s),
      error: e => this.log.error(`Settings subscription error: ${e}`, this.id),
    })
    this.radioLogService.getRadioLogObserver().subscribe({
      next: l => this.entries.set(l.logEntries ?? []),
      error: e => this.log.error(`Radio log subscription error: ${e}`, this.id),
    })
    this.locationService.getLocationsObserver().subscribe({
      next: l => this.locationCount.set(l.length),
      error: e => this.log.error(`Locations subscription error: ${e}`, this.id),
    })
    this.aarNoteService.getNotesObserver().subscribe({
      next: n => this.activityLineCount.set(n.filter(x => x.kind === 'activity').length),
      error: e => this.log.error(`After action notes subscription error: ${e}`, this.id),
    })
    this.start()
  }

  /**
   * D-62 item 5: with no stored view, a device that already holds mission data starts in Full and
   * a new install in Simple. Stored at once, so it never flips later as data arrives.
   */
  private start(): void {
    const stored = this.read(VIEW_KEY)
    const storedView = stored === 'simple' || stored === 'full' ? stored : null
    const first = initialView({ stored: storedView, hasMissionData: this.hasMissionData() })
    if (first) {
      this.store(first.view, first.source)
      return
    }
    const source = this.read(VIEW_SOURCE_KEY)
    this.viewSignal.set(storedView!)
    this.sourceSignal.set(isSource(source) ? source : FALLBACK_SOURCE)
  }

  /** Anything on the device beyond a fresh install: the same "genuinely untouched install" test
   *  the demo card and the field-phone offer use (UsageStateService 'empty'). An encrypted device
   *  holds data by definition. */
  private hasMissionData(): boolean {
    return this.usage.state() !== 'empty' || this.recordStore.isEncryptionEnabled()
  }

  /** The person's own switch (the Full view switch in the page header). */
  setView(view: AppView): void {
    if (view === 'full' && this.viewSignal() === 'simple') {
      this.justSwitchedSignal.set(true)
      setTimeout(() => this.justSwitchedSignal.set(false), 400)
    }
    this.store(view, 'user')
    this.log.info(`View set to ${view}.`, this.id)
  }

  /**
   * A Setup file's suggested view (D-62 item 6). Applies only while the device has no choice of
   * its own and records `setup`, so it is applied once and never over the person's choice.
   * Anything unknown is ignored.
   */
  suggest(suggested: unknown): void {
    const next = applySuggestedView({ suggested, source: this.sourceSignal() })
    if (!next) return
    this.store(next.view, next.source)
    this.log.info(`View set to ${next.view} by a Setup file.`, this.id)
  }

  /**
   * Whether a control shows. Components call this and nothing else (no condition of their own).
   * `here` is for facts only the page knows (the entry being edited has a value in it, the
   * layers panel holds two layers): numbers are taken as the larger of the two, booleans as
   * either, so a page can only ever show more, never hide something the mission uses.
   */
  isShown(id: string, here: Partial<ViewContext> = {}): boolean {
    const base = this.context()
    const ctx = { ...base }
    for (const k of Object.keys(here) as (keyof ViewContext)[]) {
      const v = here[k]
      if (typeof v === 'number') (ctx as Record<string, number | boolean>)[k] = Math.max(v, base[k] as number)
      else if (typeof v === 'boolean') (ctx as Record<string, number | boolean>)[k] = v || (base[k] as boolean)
    }
    return domainIsShown(id, this.viewSignal(), ctx)
  }

  /** Whether a control wears the "Advanced" marker (see domain isAdvanced). */
  isAdvanced(id: string): boolean {
    return domainIsAdvanced(id, this.viewSignal())
  }

  private store(view: AppView, source: ViewSource): void {
    this.write(VIEW_KEY, view)
    this.write(VIEW_SOURCE_KEY, source)
    this.viewSignal.set(view)
    this.sourceSignal.set(source)
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // See the class comment: a lost view comes back as the default next visit.
    }
  }
}

function isSource(s: string | null): s is ViewSource {
  return s === 'default' || s === 'upgrade' || s === 'setup' || s === 'user'
}

function sameStrings(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
}

/** Same length and, for each given field, the same values in the same order. */
function sameList<T>(a: readonly T[] | undefined, b: readonly T[], fields: (keyof T)[]): boolean {
  return Array.isArray(a) && a.length === b.length
    && a.every((row, i) => fields.every(f => row?.[f] === b[i][f]))
}
