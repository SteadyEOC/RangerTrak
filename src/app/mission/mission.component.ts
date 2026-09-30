import { Subscription } from 'rxjs'
import { DEFAULT_CHECK_IN_INTERVAL_MIN } from '../shared/overdue'
import { clearActiveDemoScenario } from '../shared/mapping/demo-map'

/**
 * Milliseconds for a value that is *typed* Date but may really be an ISO string from a JSON
 * round-trip. Returns NaN only for genuinely unusable input, which callers compare with
 * explicitly rather than relying on `<` between mismatched types (that silently yields false
 * both ways - the 0.90.5 op-period clamp bug).
 */
function asTime(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * `from` plus `hours`, as a new Date - never mutating the caller's. Uses setHours() rather
 * than adding milliseconds so it matches MissionService.initMission() exactly, and so a
 * period spanning a DST change keeps the wall-clock length an operator would expect.
 */
function addHours(from: Date, hours: number): Date {
  const result = new Date(asTime(from))
  result.setHours(result.getHours() + hours)
  return result
}


import { CommonModule, DOCUMENT } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, HostListener, Inject, OnDestroy, OnInit, computed, effect, signal, untracked
} from '@angular/core'
import { FormsModule } from '@angular/forms'
// FormField (the template directive) is gone from this component's own template: every
// control it used to drive is now a Material component bound through the FieldState's
// WritableSignal instead - see mission.component.html's Debug checkbox for why
// (angular/components#32072). The child sections still import it for their own text inputs.
import { form, max, min, required } from '@angular/forms/signals'
import { RouterLink } from '@angular/router'

import { PageComponent } from '../shared/page/page.component'
import {
  RadioLogStatusType, LocationCategoryType, LogService, MissionReadinessService,
  MISSION_SCHEMA_VERSION, DEFAULT_OP_PERIOD_HOURS, BUNDLED_IMAGE_DIRECTORY, MissionService, MissionType
} from '../shared/services/'
import { InstallUpdateComponent } from '../shared/install-update/install-update.component'
import { HasUnsavedChanges } from '../shared/guards/unsaved-changes.guard'

import { MATERIAL_IMPORTS } from '../material-imports'
import { MissionDetailsSectionComponent } from './sections/mission-details-section/mission-details-section.component'
import { MissionLocationSectionComponent } from './sections/mission-location-section/mission-location-section.component'
import { MissionMapsSectionComponent } from './sections/mission-maps-section/mission-maps-section.component'
import { MissionFieldReportStatusesComponent } from './sections/mission-field-report-statuses/mission-field-report-statuses.component'
import { MissionLocationTypesComponent } from './sections/mission-location-types/mission-location-types.component'
import { MissionLocationsListComponent } from './sections/mission-locations-list/mission-locations-list.component'
import { MissionRecipients213Component } from './sections/mission-recipients213/mission-recipients213.component'
import { MissionCommandPostComponent } from './sections/mission-command-post/mission-command-post.component'
import { MissionAdvancedOptionsComponent } from './sections/mission-advanced-options/mission-advanced-options.component'

// Placeholder used only until the real settings arrive via the constructor's synchronous
// subscription below (MissionService's ReplaySubject(1) replays its last value
// synchronously to a new subscriber, so this is overwritten before first render) - mirrors
// LocationType's undefinedLocation. Field values here are never shown to the user.
const blankMission: MissionType = {
  schemaVersion: MISSION_SCHEMA_VERSION,
  settingsName: '', settingsDate: new Date(0),
  mission: '', event: '', eventNotes: '', opPeriod: '',
  opPeriodStart: new Date(0), opPeriodEnd: new Date(0),
  application: '', version: '', debugMode: false,
  defLat: 0, defLng: 0,
  googleGeocodingApiKey: '',
  showDD: true, showDDM: true, showDMS: true, showMGRS: true, showUTM: true, showMaidenhead: true,
  maplibre: { defZoom: 15, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 },
  leaflet: { defZoom: 15, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 },
  imageDirectory: '', defRadioLogStatus: 0, radioLogStatuses: [],
  recipientOptions213: [], idFieldLabel: '', locationTypes: [],
  commandPostEnabled: false, commandPostServerUrl: '',
  checkInIntervalMin: DEFAULT_CHECK_IN_INTERVAL_MIN,
  autoPrint213: false,
}

@Component({
  selector: 'rangertrak-mission',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ...MATERIAL_IMPORTS,
    PageComponent,
    MissionDetailsSectionComponent,
    MissionLocationSectionComponent,
    MissionMapsSectionComponent,
    MissionFieldReportStatusesComponent,
    MissionLocationTypesComponent,
    MissionLocationsListComponent,
    MissionRecipients213Component,
    MissionCommandPostComponent,
    MissionAdvancedOptionsComponent,
    InstallUpdateComponent,
  ],
  templateUrl: './mission.component.html',
  styleUrls: ['./mission.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  // Deliberately NOT providing MissionService: it is providedIn:'root' and a second
  // instance here would diverge from everyone else's - see entry.component.ts's own
  // fixed-2026-08-19 note on the same historical mistake.
})
export class MissionComponent implements OnInit, OnDestroy, HasUnsavedChanges {
  private id = 'Mission Component'
  title = 'Mission'
  pageDescr = `Set various defaults and values for use in the program`

  private missionSubscription!: Subscription
  public settings!: MissionType

  // Single source of truth for the whole editable form - replaces the old
  // UntypedFormGroup built by getFormArrayFromSettingsArray()/torn back down by
  // getSettingsArrayFromFormArray(). Both are gone: the model IS a MissionType, so no
  // translation layer is needed. Constructed here, as a field initializer, because
  // form()/required() need an injection context (NG0203) - see Sprint D's Entry/Location
  // conversions for the same pattern; only missionModel.set() (never a new form()) may
  // happen later, e.g. from the subscription below or ngOnInit.
  // Only defLat/defLng carried Validators.required in the old FormBuilder version - kept
  // here as the one behavior-preserving validator; every other field was already
  // unvalidated (some sections' *.hasError('required') template checks were already dead
  // code against fields with no such validator - preserved as-is, not fixed here).
  private missionModel = signal<MissionType>(blankMission)
  // min/max restored here (Sprint E step 5, 2026-08-19) after being stripped as static HTML
  // attributes to fix NG8022 - Signal Forms owns them from schema, not the template. Values
  // are exactly what the old Reactive Forms template attributes were.
  public settingsForm = form(this.missionModel, (path) => {
    required(path.defLat); min(path.defLat, -89.99); max(path.defLat, 89.99)
    required(path.defLng); min(path.defLng, -179.99); max(path.defLng, 179.99)

    min(path.leaflet.defZoom, 1); max(path.leaflet.defZoom, 22)
    min(path.leaflet.overviewDifference, 1); max(path.leaflet.overviewDifference, 10)
    min(path.leaflet.overviewMinZoom, 1); max(path.leaflet.overviewMinZoom, 10)
    min(path.leaflet.overviewMaxZoom, 3); max(path.leaflet.overviewMaxZoom, 22)

    min(path.maplibre.defZoom, 3); max(path.maplibre.defZoom, 22)
    min(path.maplibre.overviewDifference, 1); max(path.maplibre.overviewDifference, 10)
    min(path.maplibre.overviewMinZoom, 1); max(path.maplibre.overviewMinZoom, 10)
    min(path.maplibre.overviewMaxZoom, 3); max(path.maplibre.overviewMaxZoom, 22)

    // E-118: 0 is meaningful (no fixed check-in cycle, escalation off), so the floor is 0
    // rather than `required`. The 1440 ceiling is one day - past that the ramp stops saying
    // anything useful about an operational period.
    min(path.checkInIntervalMin, 0); max(path.checkInIntervalMin, 1440)
  })

  // Mutated in the constructor's settings-subscription next callback, alongside the
  // already-signal missionModel below - bringing these two in line with it (Sprint G).
  opPeriodStart = signal(new Date())
  opPeriodEnd = signal(new Date())
  timePickerLabelStart = 'Operational Period Start Time'
  timePickerLabelEnd = 'Operational Period End Time'
  // Not user-editable - a bundled static asset path (see BUNDLED_IMAGE_DIRECTORY).
  imgDir = BUNDLED_IMAGE_DIRECTORY

  /**
   * The editable working set behind the status/color grid, owned here and handed to
   * `MissionFieldReportStatusesComponent` by reference. Unlike the read-only mirrors
   * elsewhere this cannot be a getter - the user edits these rows and the grid's
   * `addStatus()` pushes to them - so it is re-seeded from the settings subscription
   * instead, next to the model reset that already happens there. Snapshotting it only in
   * ngOnInit meant that after Restore mission the grid still showed the *previous*
   * mission's statuses, and saving from that stale grid wrote them back over the imported
   * ones. Same array reference as missionModel().radioLogStatuses - grid mutations are
   * visible on submit without any explicit sync.
   */
  rowData = signal<RadioLogStatusType[]>([])

  /**
   * ADR D-49: same "re-seeded from the settings subscription, same array reference as
   * missionModel().locationTypes" pattern as rowData above, for the mission-editable
   * Location category list (MissionLocationTypesComponent).
   */
  locationTypesRowData = signal<LocationCategoryType[]>([])

  /**
   * E-103: the working list behind the recipients-checklist editor, same "re-seeded from the
   * settings subscription" reasoning as rowData above (Restore mission / Reset Defaults must
   * replace this list, not leave a stale one from the previous mission showing).
   */
  recipientOptions213 = signal<string[]>([])

  /**
   * E-79: the header's readiness dot (ADR D-32) only ever showed the aggregate red/amber/
   * green color, so a scribe on this page had to hover the header pill and cross-reference
   * its tooltip text back against the sections below to find what was actually wrong.
   * `MissionReadinessService`'s six signals already exist individually - no new
   * decomposition needed, just surfacing them here. Two (mission name, operating period)
   * are set on this very page; the other four (roster, both offline-map signals, storage
   * persistence) are set or fixed elsewhere, so those get a link out rather than a false
   * "see below" pointing at a section that isn't the actual control.
   */
  readonly readinessGaps = computed(() => {
    const r = this.readiness
    const gaps: { label: string, severity: 'red' | 'amber', link?: string, linkText?: string }[] = []
    // Mission name and op period are edited right below this panel on this very page - read
    // them from the live (unsaved) missionModel rather than r.missionNamed()/opPeriodCurrent(),
    // which only update once the form is saved (MissionReadinessService tracks persisted
    // settings, correctly, for the header dot everywhere else). Without this, typing a name or
    // adjusting the op period here left the panel showing stale gaps until Save + reload.
    const live = this.missionModel()
    if (!live.mission.trim()) {
      gaps.push({ label: 'Mission name is not set - see the Mission section below.', severity: 'red' })
    }
    if (!r.rosterLoaded()) {
      gaps.push({
        label: 'Roster is still the untouched sample data.', severity: 'red',
        link: '/rangers', linkText: 'Load the real roster on Rangers',
      })
    }
    if (new Date(live.opPeriodEnd).getTime() <= Date.now()) {
      gaps.push({ label: 'Operating period has expired - see the Mission section below.', severity: 'amber' })
    }
    if (!r.offlineTilesSaved()) {
      gaps.push({
        label: 'No offline map tiles saved on this device yet.', severity: 'amber',
        link: '/map', linkText: 'Save an area on the Map page',
      })
    }
    if (!r.bundledMapWarmed()) {
      gaps.push({
        label: 'Backup (MapLibre) map has not been opened on this device yet.', severity: 'amber',
        link: '/map', linkText: 'Open the Map page',
      })
    }
    if (!r.storagePersisted()) {
      gaps.push({ label: 'Storage is not protected from eviction by the browser.', severity: 'amber' })
    }
    return gaps
  })

  constructor(
    private log: LogService,
    private missionService: MissionService,
    public readiness: MissionReadinessService,
    @Inject(DOCUMENT) private document: Document) {
    this.log.verbose('======== Constructor() ============', this.id)

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.log.excessive(`Received new Settings via subscription: ${JSON.stringify(newMission)}`, this.id)
        this.settings = newMission
        // 2026-09-30, John: E-145 - our own autosave emits through this same subscription
        // (updateMission() notifies synchronously). Resetting the form from that would
        // overwrite what the person is typing right now, so only a change that came from
        // somewhere else (Restore, Reset to defaults) re-seeds the form.
        if (!this.savingFromHere) {
          this.cancelPendingSave()
          this.applyMissionToForm(newMission)
        }
      },
      error: (e) => this.log.error('Mission Subscription got:' + e, this.id),
      complete: () => this.log.info('Mission Subscription complete', this.id)
    })
  }

  /** Resets the whole editable form (and its mirror signals) to a given settings snapshot -
   * shared by the settings subscription above (Restore, Reset to defaults), which discards
   * unsaved edits back to the last-saved this.settings rather than reloading the page.
   *
   * F29-23 (2026-08-30): `settingsForm().reset(newMission)`, not a raw `missionModel.set()` -
   * confirmed by reading Signal Forms' own type definitions (_structure-chunk.d.ts) before
   * assuming either way: "Programmatic changes to a control's value do not mark it dirty" is
   * the classic Reactive Forms rule this API inherits, and dirty/touched only clear via an
   * explicit `reset()` call, never implicitly from the model signal changing underneath it.
   * A plain `.set()` here would have left `hasUnsavedChanges()` (below) reporting true right
   * after Cancel discarded the very edits it's supposed to be watching for. */
  private applyMissionToForm(newMission: MissionType): void {
    // E-145: remember what is on disk BEFORE the reset below changes the model, so the
    // autosave watcher sees "nothing new" instead of saving the mission back over itself.
    this.lastSavedJson = JSON.stringify(this.payloadFor(newMission))
    this.saveState.set('idle')
    this.startupGeocodingKey ??= newMission.googleGeocodingApiKey
    this.settingsForm().reset(newMission)
    this.rowData.set(newMission.radioLogStatuses)
    this.locationTypesRowData.set(newMission.locationTypes)
    this.recipientOptions213.set(newMission.recipientOptions213)
    this.opPeriodStart.set(newMission.opPeriodStart)
    this.opPeriodEnd.set(newMission.opPeriodEnd)
  }

  /**
   * F29-23: backs both halves of the "are you sure you want to leave?" guard -
   * `unsavedChangesGuard` (in-app router navigation, wired in app.routes.ts) and this
   * component's own `beforeunload` listener just below (browser-level exit: tab close,
   * refresh, typing a new URL - a router guard cannot see either). Both read this exact
   * method rather than `settingsForm().dirty()` directly, so the two can never disagree
   * about what "unsaved" means.
   */
  hasUnsavedChanges(): boolean {
    // 2026-09-30, John: E-145 - with autosave the only things still "unsaved" are (a) an
    // edit waiting out its short delay, which is simply saved here and now so it never
    // nags, and (b) an edit the form refuses because it is invalid (a value outside its
    // allowed range, say) - the one thing a person would actually lose by leaving. Only (b)
    // returns true. The flush is a deliberate side effect: both callers run this at the
    // moment the page is going away, the last chance to save (a).
    this.flushSave()
    return this.settingsForm().invalid() && this.currentJson() !== this.lastSavedJson
  }

  /** Phones often never fire beforeunload when the app is swiped away; going to the
   * background is the last reliable moment to flush an edit that is still waiting (E-145). */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (this.document.visibilityState === 'hidden') {
      this.flushSave()
    }
  }

  /** Leaving a field saves at once instead of waiting out the delay (E-145). */
  onFocusOut(): void {
    this.flushSave()
  }

  /** Browser-level half of F29-23's guard - see hasUnsavedChanges()'s own comment for why
   * this is separate from the router's CanDeactivate guard. Standard beforeunload contract:
   * setting returnValue is what actually triggers the browser's native confirmation dialog;
   * modern browsers show their own generic wording regardless of what string is set here,
   * but the assignment itself is still required to opt in. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault()
      event.returnValue = ''
    }
  }

  ngOnInit(): void {
    if (this.settings == undefined) {
      this.log.warn('Mission needs to be initialized, in ngOnInit.', this.id)
    } else {
      // rowData is seeded by the settings subscription in the constructor (and re-seeded
      // on every later emission), so it is already populated by the time we get here.
      this.log.verbose(`Application: ${this.settings.application} -- Version: ${this.settings.version}`, this.id)
    }

    this.log.verbose("ngInit done ", this.id)
  }

  /**
   * E-71. Maintainer, 2026-08-20: "the ending op period time should be the same or later,
   * and set to the same if otherwise older."
   *
   * SUPERSEDED 2026-08-31. The invariant is now strictly `end > start`, not "the same or
   * later" - an operational period of zero length is not a legal state, so equality is a
   * violation rather than the correction for one. Maintainer: "The clamp function should
   * ensure there is no 0 length op period: use >, not just >=."
   *
   * One rule, enforced identically from both ends: whenever an edit would leave the end at
   * or before the start, the end is re-derived as start + DEFAULT_OP_PERIOD_HOURS - the
   * same 12 hours a brand-new mission is seeded with. Chosen over nudging the end to the
   * smallest legal value above the start, which would satisfy the invariant while leaving a
   * one-millisecond period that is just as useless and much harder to notice. The operator
   * keeps the last word either way: "The user can always update it manually."
   *
   * Relies on TimePickerComponent reacting
   * to `[initialDate]` changing after its own init (its `ngOnChanges`) - without that, the
   * clamp would be correct in `missionModel`/`this.settings` but the end picker's own
   * displayed value would silently disagree until the page was reloaded.
   */
  onNewTimeEventStart(newTime: Date) {
    if (!this.settings) {
      this.log.error(`this.settings is null at onNewTimeEventStart`, this.id)
      return
    }
    this.log.verbose(`Got new start OpPeriod time: ${(newTime)}`, this.id)
    this.settings.opPeriodStart = newTime
    this.opPeriodStart.set(newTime)
    this.missionModel.update(m => ({ ...m, opPeriodStart: newTime }))

    // .getTime(), never `<` on the raw signals. These are typed Date but have twice held
    // ISO strings from a JSON round-trip, and `Date < string` coerces to NaN, which is
    // false in BOTH directions - so the comparison does not fail loudly, it just stops
    // clamping. See rehydrateDates() in mission-migration.ts for the 0.90.5 bug.
    // <=, not <: an end EQUAL to the start is a zero-length period, which is a violation
    // to be corrected, not an acceptable resting state.
    if (asTime(this.opPeriodEnd()) <= asTime(newTime)) {
      this.onNewTimeEventEnd(addHours(newTime, DEFAULT_OP_PERIOD_HOURS))
    }
  }

  onNewTimeEventEnd(newTime: Date) {
    if (!this.settings) {
      this.log.error(`this.settings is null at onNewTimeEventEnd`, this.id)
      return
    }
    // Same NaN trap as onNewTimeEventStart above - compare timestamps, not objects.
    //
    // This used to snap to `start` itself, which WAS the zero-length period the invariant
    // now forbids: the correction was producing the illegal state. An end at or before the
    // start is replaced with start + 12h, exactly as the start side does.
    const start = this.opPeriodStart()
    const clamped = asTime(newTime) <= asTime(start)
      ? addHours(start, DEFAULT_OP_PERIOD_HOURS)
      : newTime
    this.log.verbose(`Got new end OpPeriod time: ${newTime}${clamped !== newTime ? ` (would not leave a positive-length period; re-derived to ${clamped})` : ''}`, this.id)
    this.settings.opPeriodEnd = clamped
    this.opPeriodEnd.set(clamped)
    this.missionModel.update(m => ({ ...m, opPeriodEnd: clamped }))
  }

  /**
   * E-103: the recipients-checklist editor (a plain textarea, one option per line - see
   * MissionRecipients213Component) emits its parsed list rather than mutating an array in
   * place the way the field-report-statuses grid does, so this mirrors onNewTimeEventStart/
   * End's "child emits, parent writes to both the mirror signal and missionModel" pattern
   * instead.
   */
  onRecipientOptions213Change(newList: string[]) {
    this.recipientOptions213.set(newList)
    this.missionModel.update(m => ({ ...m, recipientOptions213: newList }))
  }

  /**
   * Bug reported live 2026-08-31: clicking this "blinked" (the button's own ripple) but
   * nothing visibly changed. Root cause: `MissionService.ResetDefaults()` genuinely does
   * reset and persist settings (confirmed - `updateMission(initMission())`, same as every
   * other settings write) - but this component's OWN form state (`missionModel`, what the
   * template's `[formField]`s actually bind to) is a separate signal that was never resynced,
   * unlike the subscription's `applyMissionToForm()`. The settings this
   * button claims to reset ("return every setting above to its default value") were reset in
   * storage the whole time; the page just kept showing stale form values on top of them.
   * Reloading is the same fix already relied on elsewhere for this exact gap - see
   * `initMission()`'s own comment: a prior version string bug from this same button was
   * "fixed" only by whatever next reloaded the page, which is the real signal this needed
   * one all along rather than a smaller per-field resync.
   */
  onBtnResetDefaults() {
    this.log.verbose(`onBtnResetDefaults: Reset Mission.`, this.id)
    this.settings = this.missionService.ResetDefaults()
    clearActiveDemoScenario() // E-124: evicts a demo's street-detail map file
    this.reloadPage()
  }

  reloadPage() {
    // A hard reload discards anything unsaved on the page. Both callers are safe: Reset to
    // defaults has already persisted (and the settings subscription cancelled any pending
    // autosave, so nothing stale is flushed over it), and onBtnReloadNow() flushes first.
    // Since 2026-09-30 (E-145) an ordinary save no longer reloads at all.
    this.log.verbose(`Reloading window!`, this.id)
    window.location.reload()
  }

  // ── Autosave (2026-09-30, John: E-145) ────────────────────────────────────────────────
  // "Change the mission page to autosave, removing the Save settings button." Rangers already
  // saves each edit as it is made; this does the same for Mission, with a short delay so a
  // run of keystrokes is one save, not thirty.
  //
  // Saving used to reload the whole window afterwards (git log: 'fix up page reloads'), a
  // blunt way to make everything that had read the settings once pick up the new values.
  // Everything that shows or uses a mission setting while this page is open already
  // subscribes to MissionService (header pill, readiness dot, Command Post publishing,
  // alerts, the radio log service), and every other page is built fresh when opened, so none
  // of them needs a reload. The one exception is the Google geocoding key, which the app
  // reads once at start-up (app.config.ts) - see keyNeedsReload below.

  /** How long after the last change the save happens. */
  private static readonly AUTOSAVE_DELAY_MS = 800

  /** What the quiet indicator at the top of the page says. */
  readonly saveState = signal<'idle' | 'pending' | 'saved' | 'invalid'>('idle')

  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** True only while our own updateMission() call is notifying subscribers. */
  private savingFromHere = false
  /** JSON of what was last written (or loaded); an edit is anything that differs from it. */
  private lastSavedJson = ''
  /** The Google key as it was when this page loaded - the app only reads it at start-up. */
  private startupGeocodingKey: string | undefined
  readonly keyNeedsReload = computed(() =>
    this.startupGeocodingKey !== undefined
    && this.missionModel().googleGeocodingApiKey !== this.startupGeocodingKey)

  /**
   * Watches the form's model. Edits made through a field, the time pickers or the recipients
   * box all land in missionModel; grid edits change their rows in place, so those call
   * onRowsChanged() themselves. Comparing JSON to the last-saved copy means a reset from
   * Restore / defaults (which also sets the model) is correctly seen as "nothing new".
   */
  private readonly autosaveWatcher = effect(() => {
    this.missionModel()
    untracked(() => this.scheduleSave())
  })

  /** What gets written: the model plus the fixed bundled image directory (see imgDir). */
  private payloadFor(m: MissionType): MissionType {
    // A bundled static asset path, not a secret - see imgDir's own comment above; not a
    // confidentiality/encryption concern.
    return { ...m, imageDirectory: this.imgDir }
  }

  private currentJson(): string {
    return JSON.stringify(this.payloadFor(this.missionModel()))
  }

  /** The grids call this after adding or editing a row (they change their rows in place). */
  onRowsChanged(): void {
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.currentJson() === this.lastSavedJson) {
      return
    }
    this.cancelPendingSave()
    if (this.settingsForm().invalid()) {
      // Not saved; the field shows its own message as before. Saved once it is valid again.
      this.saveState.set('invalid')
      return
    }
    this.saveState.set('pending')
    this.saveTimer = setTimeout(() => this.flushSave(), MissionComponent.AUTOSAVE_DELAY_MS)
  }

  private cancelPendingSave(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
  }

  /** Saves now if there is a valid, unsaved change; otherwise does nothing. */
  private flushSave(): void {
    this.cancelPendingSave()
    if (this.currentJson() === this.lastSavedJson || this.settingsForm().invalid()) {
      return
    }
    const newMission = this.payloadFor(this.missionModel())
    this.log.verbose('Autosave: updating mission settings.', this.id)
    this.savingFromHere = true
    try {
      this.missionService.updateMission(newMission)
    } finally {
      this.savingFromHere = false
    }
    this.lastSavedJson = JSON.stringify(newMission)
    this.saveState.set('saved')
  }

  /** The one setting that only takes effect after a reload (see keyNeedsReload). */
  onBtnReloadNow(): void {
    this.flushSave()
    this.reloadPage()
  }

  //TODO: Use Utility functions with same name...
  displayHide(htmlElementID: string) {
    let e = this.document.getElementById(htmlElementID)
    if (e) {
      e.style.visibility = "hidden";
    }
  }

  displayShow(htmlElementID: string = 'mission__ColorChart-img') {
    let e = this.document.getElementById(htmlElementID)
    if (e) {
      e.style.visibility = "visible";
    }
  }

  ngOnDestroy() {
    // E-145: an edit still waiting out its delay when the page goes away is saved, not lost.
    this.flushSave()
    this.missionSubscription?.unsubscribe()
  }
}
