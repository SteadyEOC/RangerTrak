import {
  debounceTime, map, Observable, startWith, subscribeOn, Subscription, switchMap
} from 'rxjs'

import { CommonModule, DOCUMENT } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit, Component, ElementRef, EventEmitter, Inject, Input, isDevMode, NgZone, OnDestroy,
  OnInit, Output, signal, ViewChild,
  ChangeDetectionStrategy
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { form, FormField } from '@angular/forms/signals'
import { RouterLink } from '@angular/router'
import { SignalFormControl } from '@angular/forms/signals/compat'
import { MatAutocompleteTrigger } from '@angular/material/autocomplete'
import { ThemePalette } from '@angular/material/core'
import { MatSnackBar } from '@angular/material/snack-bar'

// Specific paths, not the '../shared/' barrel - see the note in location.component.ts.
import { Utility } from '../shared/utility'
import { AlertsComponent } from '../shared/alerts/alerts.component'
import { PageComponent } from '../shared/page/page.component'
// Direct path, not the shared/services barrel - see the note in rangers.component.ts.
import { RangerPhotoService } from '../shared/services/ranger-photo.service'
import { TimePickerComponent } from '../shared/time-picker/time-picker.component'
import { DDToDDM } from '../shared/mapping/coordinate'
import {
  RADIO_LOG_ENTRY_SOURCES, RadioLogService, RadioLogStatusType, LocationType, LogService,
  RangerService, RangerType, MissionService, MissionType, SampleDataService, statusColorValue,
  undefinedAddressFlag, undefinedLocation, WelcomePanelService, FieldModeService
} from '../shared/services/'
// Direct path, not the barrel above - see the note in rangers.component.ts for why a
// service used as a DI token needs this; these are plain type/const exports with no such
// constraint, but keeping the sample-scenario picker's imports together in one line is
// clearer than splitting SampleDataService itself out of the barrel import too.
import { SAMPLE_SCENARIOS, SampleScenarioId } from '../shared/services/sample-data.service'
//import { LocationComponent } from './location.component'

import { MATERIAL_IMPORTS } from '../material-imports'
import { LocationComponent } from './location.component'
import { EvidenceLocationComponent } from './evidence-location.component'
import { MiniMapLeafletComponent } from './mini-mapLeaflet.component'

// TODO: IDEA: use https://material.angular.io/components/badge/ ???


@Component({
  selector: 'rangertrak-entry',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormField,
    RouterLink,
    ...MATERIAL_IMPORTS,
    PageComponent,
    TimePickerComponent,
    LocationComponent,
    MiniMapLeafletComponent,
    EvidenceLocationComponent,
  ],
  templateUrl: './entry.component.html',
  styleUrls: ['./entry.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  // BUG-2 (2026-08-19): this used to be
  //   providers: [RangerService, RadioLogService, MissionService]
  // All three are @Injectable({providedIn:'root'}). Re-declaring them here gave Entry its
  // OWN instances, so submitted reports went into a private RadioLogService while the
  // Reports page read the root one - which still held its startup-empty list. The page
  // looked empty until a full reload made every instance re-read localStorage.
  //, TeamService
  // https://angular.io/guide/architecture-services#providing-services: 1 or multiple instances?!
  // per https://angular.io/guide/singleton-services
})
export class EntryComponent implements OnInit, AfterViewInit, OnDestroy {
  // following is never referenced: not really in use?!
  @ViewChild('timePicker') timePicker: any; // https://blog.angular-university.io/angular-viewchild/

  // Sprint D keyboard-first pass: one mechanism covers both initial-load focus and
  // post-submit focus restore (see ngAfterViewInit()/resetEntryForm() below), rather than
  // mixing cdkFocusInitial with a separate manual path.
  @ViewChild('callsignInput') private callsignInputRef?: ElementRef<HTMLInputElement>

  // E-66: the #auto template ref (`matAutocomplete="auto"`) names the mat-autocomplete PANEL,
  // not the trigger directive attached to the input by `[matAutocomplete]="auto"` - the
  // trigger is what has closePanel(), so it needs its own ViewChild via the directive type.
  @ViewChild(MatAutocompleteTrigger) private autocompleteTriggerRef?: MatAutocompleteTrigger

  //  @ViewChild('LocationComponent') myLocationPickerInstance: any//LocationComponent;
  /** Likely NOT needed...
   * If we need to call any routines from location component,
   * use ViewChild to get a reference of the actual instance we're interacting with.
   * Component initialization shouldn't be done before AfterViewInit lifecycle hook.
   * Queries on @ViewChild can only see elements inside the component's template.
   * https://blog.angular-university.io/angular-viewchild/
   */

  //@Output() newLocationEvent = new EventEmitter<LocationType>()
  // https://angular.io/guide/inputs-outputs & https://angular.io/guide/two-way-binding
  //@Output() locationEvent = new EventEmitter<LocationType>()

  // Get time events from <location> component
  //private locationSubscription!: Subscription

  // Keyboard-first tab order (Sprint D), Sprint H revision: these used to be five
  // separate hardcoded literals in the template (21, 22, 23, 24, 25, 26), each
  // silently assuming Location's field count was fixed at 19. Adding MGRS/UTM grew
  // that count, so the whole chain is now computed from one base plus each field's
  // own slot count - correct once, instead of five places each hardcoding an offset.
  callsignTabIndex = 1
  locationTabIndexStart = 2
  // Raised live, 2026-08-26: evidence/clue location moved into the Where section itself
  // (entry.component.html) - it IS a location, and reading it right after the reporter's own
  // position makes more sense than finding it after the whole 213 section, far down the
  // form. Reordering the chain, not just the HTML, is the point: this app's own
  // checkEntryTabOrder e2e check asserts tabindexes ascend in DOM order, so a moved element
  // needs its slot moved too, not left where it was.
  //
  // Architecture decision, 2026-08-26 (unchanged since): evidence/clue location is hidden by
  // default behind a checkbox - same [hidden]-not-@if reasoning as the 213 fields below, so
  // its 3 reserved slots (EvidenceLocationComponent's own distance/unit/bearing, see its ti()
  // offsets) don't break tab-order contiguity while collapsed, the common case.
  showEvidenceLocationTabIndex = this.locationTabIndexStart + LocationComponent.TAB_SLOT_COUNT
  evidenceLocationTabIndexStart = this.showEvidenceLocationTabIndex + 1
  dateTabIndex = this.evidenceLocationTabIndexStart + 3
  // 2026-08-22: was `timeTabIndex = this.dateTabIndex + 1` (a single slot) - the time
  // picker's hour/minute each need their own tab stop (see
  // TimePickerComponent.TIME_TAB_SLOT_COUNT), same reservation pattern as Location's own
  // TAB_SLOT_COUNT above. (A third slot, AM/PM, existed here until 2026-08-30 when the
  // picker switched to 24-hour display - TIME_TAB_SLOT_COUNT dropping to 2 renumbers
  // everything after it automatically.)
  timeTabIndexStart = this.dateTabIndex + 1
  statusTabIndex = this.timeTabIndexStart + TimePickerComponent.TIME_TAB_SLOT_COUNT
  // E-41 phase 1 (2026-08-26): Source is gathered on every report, always - reserved right
  // after Status, same "classification field" grouping. The three ICS-213 fields only ever
  // render once generates213Ctrl is checked, but reserve real tab stops regardless (a
  // hidden/unrendered control is simply skipped in tab order by the browser - same reasoning
  // Location/TimePicker's own TAB_SLOT_COUNT already relies on for a variable field count).
  sourceTabIndex = this.statusTabIndex + 1
  notesTabIndex = this.sourceTabIndex + 1
  generates213TabIndex = this.notesTabIndex + 1
  replyRequested213TabIndex = this.generates213TabIndex + 1
  // E-103: the per-mission definable recipients213 checkbox list is a runtime-variable-length
  // group, not a fixed set of fields - it gets ONE reserved tab stop for the whole group, the
  // same convention Status's mat-radio-group uses above for its own per-mission configurable
  // list (settings.radioLogStatuses). Individual checkboxes render with no explicit
  // tabindex, so they're naturally focusable (browser default) without disturbing this app's
  // "contiguous explicit tabindex 1..N" invariant (tools/e2e.js's checkEntryTabOrder) the way
  // a per-option slot count tied to settings data - unknowable at compile time - would.
  recipients213CheckboxesTabIndex = this.replyRequested213TabIndex + 1
  recipients213TabIndex = this.recipients213CheckboxesTabIndex + 1
  // 2026-08-26: "To" (the recipients checklist + Additional recipients) moved ABOVE the
  // message body in entry.component.html, on the maintainer's ask - you address a 213
  // before you write it, and the message's own tooltip refers to whoever is listed under
  // To. The tab chain had to move WITH the markup, not just the markup: this app's
  // checkEntryTabOrder() asserts tabindexes ascend in DOM order, so leaving message213 at
  // its old slot would have left the sequence reading 40, 42, 43, 41 - the exact failure
  // the coordinate-system reorder already hit once. Total is unchanged at 45.
  message213TabIndex = this.recipients213TabIndex + 1
  // F29-47 (2026-08-29): two new fields inserted at the tail of the chain, from two
  // different items - subject213 belongs INSIDE the 213 section (last, after Message, per
  // the maintainer's own placement ask), operator belongs OUTSIDE it (applies to every
  // report, not only 213s) - see entry.component.html's own tabindex-chain comment.
  subject213TabIndex = this.message213TabIndex + 1
  operatorTabIndex = this.subject213TabIndex + 1
  resetTabIndex = this.operatorTabIndex + 1
  submitTabIndex = this.resetTabIndex + 1

  // E-41 phase 1: source options for the template's @for - the values themselves are
  // already the labels wanted (RADIO_LOG_ENTRY_SOURCES), a plain readonly re-export so the
  // template doesn't need to import the const directly.
  readonly sourceOptions = RADIO_LOG_ENTRY_SOURCES

  private id = 'Entry Form'
  title = 'Field Report Entry'
  pageDescr = `Enter data associated with ranger's name, location, status for tracking on maps & spreadsheets`

  // REVIEW: do async auto-subscriptions from the HTML side instead?
  private rangersSubscription!: Subscription
  public rangers: RangerType[] = []
  filteredRangers!: Observable<RangerType[]>

  private missionSubscription!: Subscription
  public settings!: MissionType

  // Get time events from <timepicker> component
  //private timeSubscription!: Subscription  //! EVER USED?!
  timePickerLabel = "Enter Report Date, Time"

  alert: AlertsComponent

  // --------------- ENTRY FORM -----------------
  // Sprint D: id/location/date/notes never touch Material controls that lack [formField]
  // support, so they're a native signal form. callsign (mat-autocomplete) and status
  // (mat-radio-group) don't support [formField] in the installed Angular Material
  // (angular/components#32072, still open) - those two stay classic FormControls, upgraded
  // to SignalFormControl for signal-side readability, living in their own small FormGroup
  // bound the old way (formControlName) in the template. See plan §3 / Context.
  // Real initial value (location: this.locationParent) is set by initEntryForm(), called
  // from ngOnInit() - NOT here, since this field initializer runs before locationParent's
  // own declaration below is assigned.
  // E-41 phase 1: source/generates213/replyRequested213/message213/recipients213 added
  // 2026-08-26 - none of these touch a Material control that lacks [formField] support, so
  // they belong in this native signal form alongside id/location/date/notes, not the
  // classic FormGroup below (that one exists solely for the two fields that genuinely can't
  // use this).
  private entryModel = signal({
    id: -1, location: undefinedLocation, date: new Date(), notes: '',
    source: 'Voice',
    generates213: false, replyRequested213: false, message213: '', recipients213: '',
    subject213: '',
  })
  public entryForm = form(this.entryModel)

  // D-44 (2026-08-29): operator identity, deliberately OUTSIDE entryModel - unlike every
  // field above, resetAll() must NOT clear this. The maintainer's rule: it carries forward
  // from the previous entry within the same session (successive entries are usually the same
  // scribe), blank only on a fresh page load - "blank values (at least historically) are
  // fine." Stamped onto the report at submit time (mergedFormValue()), never looked up
  // later - rewriting who logged a past entry after a shift change would be a records-
  // integrity failure, not a cosmetic one. No persisted setting/default - the field sitting
  // right above Submit, reviewed on every entry, is the safety mechanism, not storage.
  private operatorModel = signal({ operator: '' })
  public operatorForm = form(this.operatorModel)

  // Starts editable (nothing entered yet has nothing to summarize). Collapses to a compact
  // read-only line once resetAll() runs with a non-blank operator, so the common case (same
  // scribe, many entries) doesn't carry a permanently-open extra input on the hot path - the
  // maintainer's own "readily reviewed & changed" is served by the edit affordance, not by
  // leaving the box open. See resetAll() and the template's own operator section.
  operatorEditing = signal(true)

  // Constructed once, here, as a field initializer - like entryForm above. SignalFormControl's
  // constructor needs an injection context (NG0203), which a field initializer is but a method
  // called from ngOnInit() is not. initEntryForm()/resetAll() below set VALUES on these existing
  // controls rather than constructing new ones. Initial status is corrected once settings
  // arrive - see initEntryForm().
  public entryControlsForm = new FormGroup({
    status: new SignalFormControl('')
  })
  // The one and only callsign control. It drives the mat-autocomplete's filtering AND is what
  // gets saved - see BUG-1 in entry.component.html. Typed to string so .value needs no cast.
  callsignCtrl = new FormControl<string>('', { nonNullable: true })
  //readonly imagePath = "'./assets/imgs/rangers/'" // not yet used by *.html

  // Get location events from <location> component
  //public locationChange: Subscription
  public locationParent = undefinedLocation

  // Architecture decision, 2026-08-26: evidence/clue location - hidden by default (a plain
  // signal, not part of any form model, same "session UI state, not report data" treatment
  // LocationComponent's own activeSystem uses - E-104, 2026-08-26 - for which coordinate
  // format currently has the editable fields), a checkbox reveals EvidenceLocationComponent.
  // evidenceLocation itself mirrors locationParent's own pattern
  // (a plain field the child emits into, merged into the submission in mergedFormValue()
  // below) rather than living inside entryModel - same reason locationParent doesn't either.
  showEvidenceLocation = signal(false)
  evidenceLocation: LocationType | null = null

  onEvidenceLocationChange(newLocation: LocationType | null): void {
    this.evidenceLocation = newLocation
  }

  // E-105 (2026-08-27): Alt+click on the mini-map marks evidence directly instead of typing
  // a distance/bearing - see mini-mapLeaflet.component.ts's own onMouseClick for why this is
  // a modifier key, not a second click target. Reveals the field if it wasn't already open;
  // a scribe who Alt+clicks clearly wants it, so requiring the checkbox first would just be
  // a second, redundant step. A signal, not a plain field: this app is zoneless, and a
  // second Alt+click while the field is already open would otherwise change only a plain
  // property with nothing left to trigger the change detection pass that reads it -
  // showEvidenceLocation.set(true) is a no-op (already true) in exactly that case, so it
  // can't be relied on to do that job. A fresh object every call, not reusing the previous
  // one, is what makes EvidenceLocationComponent's ngOnChanges register repeat clicks on
  // the same spot as real changes rather than a no-op of its own.
  evidenceClickedPosition = signal<{ lat: number, lng: number } | null>(null)

  onEvidenceMapClick(pos: { lat: number, lng: number }): void {
    this.showEvidenceLocation.set(true)
    this.evidenceClickedPosition.set({ ...pos })
  }

  // E-103: which of settings.recipientOptions213's per-mission checklist entries are ticked.
  // A plain signal outside entryModel/entryForm, same reasoning as showEvidenceLocation above -
  // the option list's length varies per mission, so it can't be a static Signal Forms field.
  // recipients213 itself (in entryModel) stays free text for anything NOT on the checklist;
  // mergedFormValue() combines both into the RadioLogEntryType.recipients213 list at submission.
  selectedRecipients213 = signal<Set<string>>(new Set())

  toggleRecipient213(option: string, checked: boolean) {
    this.selectedRecipients213.update(current => {
      const next = new Set(current)
      if (checked) {
        next.add(option)
      } else {
        next.delete(option)
      }
      return next
    })
  }

  // E-48(1): bumped on every reset (see resetAll() below) so LocationComponent can tell
  // "a fresh report started" apart from "the position changed" - see its own comment.
  formGeneration = 0

  minDate = new Date()

  submitInfo: HTMLElement | null = null
  callImg: HTMLElement | null = null
  callInfo: HTMLElement | null = null

  // https://github.com/h2qutc/angular-material-components
  // TODO: Consider for tracking ValueChanges: https://angular.io/guide/observables-in-angular#reactive-forms
  // https://material.angular.io/components/autocomplete/examples#autocomplete-overview; also Ang Dev with TS, pg 140ff; Must be in OnInit, once component properties initialized


  constructor(
    private rangerService: RangerService,
    private photos: RangerPhotoService,
    private radioLogService: RadioLogService,
    private log: LogService,
    private missionService: MissionService,
    private _snackBar: MatSnackBar,
    private http: HttpClient,
    private zone: NgZone,
    public welcomePanel: WelcomePanelService,
    public fieldMode: FieldModeService,
    private sampleDataService: SampleDataService,
    @Inject(DOCUMENT) private document: Document) {

    this.log.excessive(`======== constructor() ============`, this.id)

    // https://angular.io/tutorial/toh-pt4#call-it-in-ngoninit states subscribes should happen in OnInit()
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        // REVIEW: If new Default Location, do we switch to that, or any currenlty in 'use'?
        if (JSON.stringify(this.locationParent) === JSON.stringify(undefinedLocation)) {
          // Local location has yet to be set

          this.log.excessive('Setting updated location based on default settings.', this.id)
          // Settings just store default lat/lng, not address.
          // Child will figure out the address...
          this.locationParent = {
            lat: this.settings.defLat,
            lng: this.settings.defLng,
            address: undefinedAddressFlag,
            derivedFromAddress: false
          }
        }
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('Settings Subscription complete', this.id)
    })

    // TODO: Move callSign input to new component?
    this.rangersSubscription = this.rangerService.getRangersObserver().subscribe({
      next: (newRangers) => {
        this.rangers = newRangers
        this.log.excessive('Received new Rangers via subscription.', this.id)
      },
      error: (e) => this.log.error('Rangers Subscription got:' + e, this.id),
      complete: () => this.log.info('Rangers Subscription complete', this.id)
    })

    // TODO: Use Alert Service to avoid passing along doc & snackbar properties!
    this.alert = new AlertsComponent(this._snackBar, this.log, this.missionService, this.document)

    //! https://material.angular.io/components/autocomplete/examples#autocomplete-overview has this in constructor!
    // also Ang Dev with TS, pg 140ff; Must be in OnInit, once component properties initialized
    this.initFilteredRangers()

    // NOTE: workaround for onChange not working...
    // https://material.angular.io/components/autocomplete/examples#autocomplete-overview; also Ang Dev with TS, pg 140ff; Must be in OnInit, once component properties initialized
    this.callsignCtrl.valueChanges.pipe(debounceTime(700)).subscribe(newCall => this.callsignChanged(newCall))
  }

  // https://angular.io/guide/practical-observable-usage#type-ahead-suggestions


  /**
   * Persist new location so when form is submitted it gets recorded...
   * Values automatically propogate to any children (mini-map in this case) via their @Input statements
   *
   * @param newLocation
   */
  onNewLocationEvent(newLocation: LocationType) { //LocationType) {
    // Based on listing 8.8 in TS dev w/ TS, pg 188
    this.log.info(`Entry form (parent) got new Location: ${JSON.stringify(newLocation)}`, this.id)

    //!BUG: The next line *should* propogate new value to all children, but only does so intermittently...
    this.log.info(`locationParent was: ${JSON.stringify(this.locationParent)}`, this.id)
    this.locationParent = newLocation
    //this.locationParent.lat += 0.0000001  //! REMOVE ME!
    this.log.info(`locationParent now: ${JSON.stringify(this.locationParent)}`, this.id)

    // patch entryForm's model - as THAT is what gets saved with on form submit
    this.entryModel.update(m => ({ ...m, location: newLocation }))
  }

  /**
   * Called when this.timepickerFormControl has emitted a new event
   *
   * Persist new time/date so when form is submitted it gets recorded...
   *
   * Based on listing 8.8 in TS dev w/ TS, pg 188
   *
   * @param newTime
   */
  onNewTimeEvent(newTime: Date) {
    this.log.verbose(`Got new Report time: ${newTime}`, this.id)
    this.entryModel.update(m => ({ ...m, date: newTime }))
  }

  /**
   * Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
   *
   * Autocomplete must be in OnInit, once component properties initialized
   *
   * https://material.angular.io/components/autocomplete/examples#autocomplete-overview;
   * also Ang Dev with TS, pg 140ff;
   */
  //

  /**
   * Raised live 2026-08-30: "makes it REAL easy to do a demo/try it out." True only on a
   * genuinely untouched install - all three: no rangers imported, no field reports (which
   * covers Messages too, a message is a field report with generates213 set - there is no
   * way to have a message without a report), and no mission name set yet. Any one of those
   * being real means there is something a demo-data load could clobber, so the button
   * disappears the moment any of them stops being true.
   */
  canLoadDemoData(): boolean {
    return this.rangers.length === 0
      && this.radioLogService.getCurrentRadioLog().numReport === 0
      && !this.settings?.mission?.trim()
  }

  /** Scenario picker for the "Load Demo Data" button below - see SAMPLE_SCENARIOS' own
   *  comment for what each option means. Defaults to Vashon, the original demo. */
  readonly sampleScenarios = SAMPLE_SCENARIOS
  selectedScenario = signal<SampleScenarioId>('vashon')

  /**
   * No confirm() dialog, unlike every other place this same action is offered
   * (mission-advanced-options.component.ts) - those guard a REPLACE of existing data;
   * canLoadDemoData() above already guarantees there is nothing to replace here.
   */
  async onLoadDemoData(): Promise<void> {
    await this.sampleDataService.loadSampleMission(this.selectedScenario())
    this.log.warn('Loaded the sample mission (demo data) from the Entry welcome panel.', this.id)
    window.location.reload()
  }

  /**
   * E-114 §1a first-run prompt: the one place a device declares itself a ranger's own field
   * phone rather than a command-post/scribe device. Same `canLoadDemoData()` gate as the demo
   * data button above - this device has nothing to lose by re-scoping itself down, and once
   * any real data exists the question stops making sense to ask (a scribe laptop mid-mission
   * doesn't suddenly become someone's field phone). Reloads for the same reason
   * `onLoadDemoData()` does - nav/route gating below reads `fieldMode.enabled()` at
   * construction time in a few places, and a reload is simpler and more reliable than chasing
   * every one of them with a signal effect.
   */
  onEnableFieldMode(): void {
    this.fieldMode.enable()
    window.location.reload()
  }

  /**
   * E-114 Phase 1 (2026-08-31): the field-mode "send my reports" action - builds a Report
   * Packet of every report on THIS device and hands it off via the OS share sheet (Web
   * Share API) where supported, falling back to a plain download everywhere else. Identical
   * mechanics to RadioLogComponent's own `onBtnBuildReportPacket()`, which a field-mode
   * device cannot reach at all (its route is hidden by `fieldModeGuard` - the full Radio Log
   * grid is command-post furniture a single self-reporting ranger's phone has no use for).
   * The packet ASSEMBLY itself lives in `RadioLogService.buildReportPacketText()` so the two
   * buttons can never drift apart on what actually goes in the file - see that method's own
   * doc comment.
   *
   * `operator` is this device's own operatorModel (D-44) - unlike RadioLogComponent's blank
   * placeholder (that page has no "who is at the keyboard" concept), Entry always knows who
   * that is for a field-mode device, since it is the same credential the ranger already
   * self-typed once to resolve their identity for merge purposes (E-114 §1a).
   */
  async onBtnSendMyReports(): Promise<void> {
    const built = this.radioLogService.buildReportPacketText(this.operatorModel().operator.trim())
    if (!built) {
      alert('There are no reports on this device to send yet.')
      return
    }
    const { text, filename, count } = built
    const file = new File([text], filename, { type: 'text/plain' })

    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'RangerTrak Report Packet' })
        this.log.info(`Shared Report Packet: ${filename} (${count} reports).`, this.id)
        return
      } catch (e: any) {
        // AbortError = the ranger cancelled the share sheet - not a failure, just fall
        // through to the plain download so they still have a way to get the file.
        this.log.warn(`Report Packet share cancelled or failed, falling back to download: ${e?.message ?? e}`, this.id)
      }
    }

    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = this.document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    this.log.info(`Downloaded Report Packet: ${filename} (${count} reports).`, this.id)
  }

  ngOnInit(): void {
    this.log.info(`EntryForm initialization with development mode ${isDevMode() ? "" : "NOT "} enabled`, this.id)

    /*
        this.sha256("hello").then(digestValue => {
          console.error(` ########## SECRET      Digest is: ${digestValue}`)
        });
    */

    this.log.excessive("EntryComponent - ngOnInit - Use settings to fill form", this.id)

    // https://angular.io/api/router/Resolve - following fails as MissionComponent has yet to run...
    // or even https://stackoverflow.com/questions/35655361/angular2-how-to-load-data-before-rendering-the-component
    this.log.excessive(`Running ${this.settings?.application} version ${this.settings?.version} `, this.id)
    // verifies Settings has been loaded

    /*  if receiving the https://flexiple.com/angular/expressionchangedafterithasbeencheckederror/
        i.e., entryDetailsForm probably constructed at wrong time...
        Move the component creation to ngOnInit hook
        error can show up when you are working with ViewChild, and execute code in AfterViewInit.

        the binding expression changes after being checked by Angular during the change detection cycle
   */


    this.initEntryForm()

    this.submitInfo = this.document.getElementById("enter__Submit-info")
    if (!this.submitInfo) {
      this.log.error(`Could not find enter__Submit-info field`, this.id)
    }

    if (this.settings?.debugMode) {
      Utility.displayShow(this.document.getElementById("enter__frm-reguritation")!)
      Utility.displayShow(this.document.getElementById("enter__where-debug")!)
    }

    if (this.rangers.length < 1) {
      this.alert.Banner('Welcome! First load your rangers (at the bottom of the Rangers page) & then review items in the Settings Page.', 'Go to Rangers, then Settings pages', 'Ignore')
      //this.alert.OpenSnackBar(`No Rangers exist.Please go to Advance section at bottom of Ranger page!`, `No Rangers yet exist.`, 2000)
      //TODO: Force navigation to /Rangers?

      this.log.excessive(` ngOnInit completed`, this.id)
    }

    this.tryGpsAutoFill()

    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
  }

  /**
   * E-114 §1a (2026-08-31): "location just defaults to phone's GPS" - the maintainer's own
   * design for the zero-provisioning field-mode device. Field mode ONLY: a command-post/
   * scribe laptop's own position is usually not the incident location at all (it's staged
   * nearby, sometimes miles away), so silently overwriting the mission's configured default
   * there would be wrong far more often than right - see the missionSubscription's own
   * defLat/defLng fallback in the constructor above, which stays correct for that device
   * type.
   *
   * A best-effort upgrade, never a blocking requirement - a denied permission, an
   * unavailable API, or a slow/failed fix just leaves the existing mission-default location
   * in place, exactly as before this method existed. Only ever attempted once per page load,
   * not on every resetAll() - a ranger's own phone doesn't usually teleport between
   * consecutive reports, and resetAll() already deliberately carries `locationParent`
   * forward for exactly that reason (see its own comment).
   *
   * `before` guards the one real race: `getCurrentPosition()` can take several seconds, long
   * enough for a ranger to have already started typing/pasting a location by hand before the
   * fix resolves. `onNewLocationEvent()` always assigns a NEW object to `locationParent`
   * (never mutates in place), so an identity check is enough to detect "something else set
   * this in the meantime" and skip the now-stale GPS fix rather than clobber a real edit.
   */
  private tryGpsAutoFill(): void {
    if (!this.fieldMode.enabled()) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return

    const before = this.locationParent
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (this.locationParent !== before) {
          this.log.info('Field mode GPS fix arrived after the location was already changed - not overwriting it.', this.id)
          return
        }
        this.log.info(`Field mode GPS auto-fill: ${position.coords.latitude}, ${position.coords.longitude}`, this.id)
        this.onNewLocationEvent({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          address: undefinedAddressFlag,
          derivedFromAddress: false,
        })
      },
      (err) => {
        this.log.warn(`Field mode GPS auto-fill unavailable (${err.message}) - keeping the mission default location.`, this.id)
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  }

  /**
   * E-114 §2b (2026-08-31): "flag immediately if the connection is unavailable" - shown only
   * on a field-mode device (see the template), since a command-post laptop's own online/
   * offline state has never mattered to Entry (this app is offline-first by design for
   * everyone, per the welcome panel's own text). Same plain `navigator.onLine`/online/
   * offline idiom `location.component.ts`'s own `isOnline` already established, reused
   * rather than a new shared service - deliberately narrow for now: informational only, not
   * wired to block submission or to the actual hand-off transport yet (§2's queued-transport
   * design is still open - see Private Roadmap.md's own open questions).
   */
  isOnline = signal(navigator.onLine)
  private readonly onOnline = () => this.isOnline.set(true)
  private readonly onOffline = () => this.isOnline.set(false)


  /**
   * Encrpyt reports before storing them?
   * REVIEW: If so, do so in the read/writing service...not here
   *
   * @param str
   * @returns
   */
  async sha256(str: string) {
    const encoder = new TextEncoder();
    const encdata = encoder.encode(str);
    const buf = await crypto.subtle.digest("SHA-256", encdata);
    return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
  }

  /**
   * Called once all HTML elements have been created
   */
  ngAfterViewInit() {
    this.focusCallsignSuppressingAutoOpen()
  }

  /**
   * E-66: `MatAutocompleteTrigger._handleFocus()` opens the panel on ANY `focusin`, including
   * a synthetic one this component issues itself (this call, and its twin after submit+reset
   * in resetEntryForm() below) - it has no notion of "this focus wasn't the user asking to
   * see the roster." An empty query matches every ranger, so the panel that opens is the
   * whole roster, covering the mini-map beneath it.
   *
   * A binding-based suppression (toggle `[matAutocompleteDisabled]` true-then-false around the
   * `.focus()` call) does NOT work here: both signal writes happen synchronously in the same
   * tick, before Angular's zoneless scheduler ever runs a change-detection pass to actually
   * propagate `true` into the directive's input - by the time any CD pass reads the signal,
   * it already reads `false`, so the directive's own `autocompleteDisabled` field was never
   * actually `true` at the moment `.focus()` fired. Tried and confirmed ineffective before
   * landing on this instead.
   *
   * `HTMLElement.focus()` dispatches its `focus`/`focusin` events SYNCHRONOUSLY before
   * returning, so `_handleFocus()` (and therefore `openPanel()`) has already run by the time
   * `.focus()` returns control here - closing it immediately after, same synchronous tick, no
   * paint has happened in between (the browser cannot paint mid-script), so the panel never
   * becomes visible. A real subsequent user focus (tab-in, click) calls `_handleFocus()` on
   * its own, with nothing here between it and the browser's paint - untouched, opens normally.
   */
  private focusCallsignSuppressingAutoOpen(): void {
    this.callsignInputRef?.nativeElement.focus()
    this.autocompleteTriggerRef?.closePanel()
  }

  /**
   * https://material.angular.io/components/autocomplete/examples#autocomplete-optgroup
   * @param value
   * @returns
   */
  /**
   * ADR D-42/D-43: matches callsign OR name OR credential id, not callsign alone.
   *
   * This is a requirement, not a nicety. Filtering on callsign only made a ranger WITHOUT a
   * callsign impossible to select at all - and that population (CERT/MERT responders who are
   * not ham-licensed) is the entire reason D-42 exists. They were in the roster, and the one
   * control for attributing a report to them could not find them.
   */
  /**
   * Resolves what the scribe typed (or picked) to one ranger, or null.
   *
   * Matches the same three fields `_filterRangers()` offers, and in the same priority order
   * the autocomplete presents them, so "the row I clicked" and "the row this resolves to"
   * cannot disagree. Exact match only - a substring is fine for *narrowing a list a human
   * then picks from*, but not for silently deciding who a report belongs to.
   */
  private matchRanger(value: string): RangerType | null {
    const needle = value.trim().toLowerCase()
    if (!needle) {
      return null
    }
    return this.rangers.find(r => r.callsign?.trim().toLowerCase() === needle)
      ?? this.rangers.find(r => r.fullName?.trim().toLowerCase() === needle)
      ?? this.rangers.find(r => r.id?.trim().toLowerCase() === needle)
      ?? null
  }

  private _filterRangers(value: string): RangerType[] {
    const filterValue = value.toLowerCase()
    if (!filterValue) {
      return this.rangers.slice()
    }
    return this.rangers.filter(r =>
      r.callsign?.toLowerCase().includes(filterValue)
      || r.fullName?.toLowerCase().includes(filterValue)
      || r.id?.toLowerCase().includes(filterValue))
  }

  /**
   * Transforms Settings Array into Form Array
   */
  initEntryForm() {

    if (!this.settings) {
      this.log.error(`this.settings was null in initEntryForm`, this.id)
      return
    }

    this.entryModel.set({
      id: -1,
      location: this.locationParent,
      date: new Date(),
      notes: '',
      source: 'Voice',
      generates213: false, replyRequested213: false, message213: '', recipients213: '',
      subject213: '',
    })
    // operatorModel is deliberately NOT reset here - see its own declaration above.
    this.callsignCtrl.setValue('')
    this.entryControlsForm.setValue({
      status: this.settings.radioLogStatuses[this.settings.defRadioLogStatus].status
    })
  }

  /**
   * Combined value across both form halves - split only because of the mat-autocomplete/
   * mat-radio-group [formField] interop gap (see entryControlsForm above), not a
   * meaningful data boundary. Used for both submission and the debug regurgitation panel.
   */
  mergedFormValue() {
    // ADR D-42/D-43: attribute the report to a ranger by the surrogate `uid`, resolved from
    // whatever the scribe actually typed or picked.
    //
    // `callsign` is written from the RESOLVED ranger, not from the text in the box: for a
    // ranger with no callsign the option shows their name (see the template), and storing
    // that name in a field meaning "what came over the radio" would be a small lie. Their
    // report correctly carries a blank callsign, with `rangerUid` carrying the identity.
    //
    // An unmatched entry keeps the raw text as the callsign and an empty uid - a scribe
    // logging a callsign that isn't in the roster yet is normal mid-incident, and losing what
    // they heard would be worse than an unresolved join.
    const typed = (this.callsignCtrl.value ?? '').trim()
    const match = this.matchRanger(typed)

    return {
      ...this.entryModel(),
      rangerUid: match?.uid ?? '',
      callsign: match ? match.callsign : typed,
      status: this.entryControlsForm.value.status,
      // D-44: stamped from whatever operatorModel holds AT SUBMIT - see its own declaration.
      // Trimmed so "typed then deleted" reads as blank, not whitespace.
      operator: this.operatorModel().operator.trim(),
      // Only when the section is actually open - collapsing it after entering a range/
      // bearing is how a scribe retracts "never mind, not a real clue," and a submitted
      // report shouldn't carry a marker its own scribe just told the form to forget.
      evidenceLocation: this.showEvidenceLocation() ? this.evidenceLocation : null,
      // E-103: RadioLogEntryType.recipients213 combines the per-mission checklist's checked
      // options with anything typed into the "Additional" free text - a Set dedupes the rare
      // case a scribe both checks a box AND types the same name again, the same "one
      // meaningful data boundary" reasoning as rangerUid/callsign above.
      recipients213: Array.from(new Set([
        ...this.selectedRecipients213(),
        ...this.splitRecipients213(this.entryModel().recipients213),
      ])),
    }
  }

  /** Comma-separated free text -> a trimmed, non-empty list. See mergedFormValue()'s note. */
  private splitRecipients213(raw: string): string[] {
    return raw.split(',').map(r => r.trim()).filter(r => r.length > 0)
  }

  /**
   * Stored status color -> a CSS color for the status radio labels. Semantic keys resolve
   * to their --rt-status-* token (which carries light/dark); a custom color passes through.
   * See status-color.ts.
   */
  statusColor(stored: string): string {
    return statusColorValue(stored)
  }

  /** Combined validity across both form halves - drives Submit's [disabled] and the debug panel. */
  formValid() {
    return this.entryForm().valid() && this.entryControlsForm.valid && this.callsignCtrl.valid
  }

  initFilteredRangers() {
    this.filteredRangers = this.callsignCtrl.valueChanges.pipe(
      startWith(''),
      map(callsign => (callsign ? this._filterRangers(callsign) : this.rangers.slice())),
    )
  }

  /**
   * Reinitializes Form Array values - without recrating a new object
   *
   * https://angular.io/guide/reactive-forms#!#_reset_-the-form-flags
   * https://stackoverflow.com/a/54048660
   */
  resetEntryForm() {

    //Utility.getUsers()


    if (!this.settings) {
      this.log.error(`this.settings was null in initEntryForm`, this.id)
      return
    }
    this.log.verbose("Resetting form...", this.id)
    this.resetAll()

    // !BUG: Need to reset callsign too: otherwise filtered to just this one!
    //this._filterRangers("")
    this.initFilteredRangers()

    // After the reset values above have settled, not before - restores focus to callsign
    // for the next entry, same as the initial-load focus in ngAfterViewInit().
    this.focusCallsignSuppressingAutoOpen()
  }

  /**
   * Resets all three pieces of the split form together - the native signal form
   * (id/location/date/notes), the standalone callsignCtrl, and the classic FormGroup holding
   * status (both kept classic for the mat-autocomplete/mat-radio-group interop gap - see
   * entryControlsForm above). One helper covering all of them so a future edit cannot reset
   * some and forget the rest.
   */
  private resetAll() {
    // !REVIEW: Should we reset locationParent to default location (from settings)?
    this.entryModel.set({
      id: -2,
      location: this.locationParent,
      date: new Date(),
      notes: '',
      source: 'Voice',
      generates213: false, replyRequested213: false, message213: '', recipients213: '',
      subject213: '',
    })
    // D-44: operatorModel is deliberately NOT reset - it carries forward across entries in
    // the same session (see its own declaration). Only its EDITING state changes here: once
    // a name has actually been entered, later resets collapse it to the compact summary line
    // rather than reopening a live input every single time - still one click away via the
    // edit affordance. A blank operator stays open, since there is nothing to summarize and
    // it's still worth a scribe's attention.
    if (this.operatorModel().operator.trim()) {
      this.operatorEditing.set(false)
    }
    this.callsignCtrl.reset('')
    this.entryControlsForm.reset({
      status: this.settings.radioLogStatuses[this.settings.defRadioLogStatus].status
    })
    // EvidenceLocationComponent resets its own distance/unit/bearing fields when
    // formGeneration bumps below (same pattern LocationComponent's derived-block already
    // uses) - collapsing the section and forgetting the computed marker are this
    // component's own job, since both live here, not inside the child.
    this.showEvidenceLocation.set(false)
    this.evidenceLocation = null
    this.selectedRecipients213.set(new Set())
    this.formGeneration++
  }

  /** The operator summary line's edit affordance. */
  onBtnEditOperator() {
    this.operatorEditing.set(true)
  }

  callsignChanged(callsign: string) { // Just serves timer for input field - post interaction
    this.log.excessive(`EntryForm CallsignChanged()`, this.id)

    this.callImg = this.document.getElementById("enter__Callsign-image")
    this.callInfo = this.document.getElementById("enter__Callsign-upshot")
    if (this.callImg && this.callInfo) {
      // An empty callsign is the normal state right after a reset (see resetAll()) - not an
      // "unknown" one. Routing it through getRanger() logged a false GetRanger error on
      // every single submit, once callsignCtrl started actually being reset (BUG-1 fix,
      // 2026-08-19) instead of being silently orphaned as it was before.
      if (!callsign) {
        this.callImg.innerHTML = ''
        this.callInfo.innerHTML = ''
        return
      }

      this.log.verbose(`EntryForm callsignChanged looking for ${callsign}`, this.id)

      let ranger = this.rangerService.getRangerByCallsign(callsign)

      // E-38. This is the photo's whole purpose: confirming *who* a report is about, while
      // it is being entered. Order: a photograph stored on this device (D-35 - never in the
      // repo), then whatever the roster names, then the generic silhouette. The silhouette
      // matters because the previous fallback was a broken-image icon.
      const localPhoto = this.photos.photoUrl(ranger)
      const src = localPhoto
        || (ranger.image
          ? `${this.settings.imageDirectory}rangers/${ranger.image}`
          : `${this.settings.imageDirectory}rangers/androgynous.svg`)

      this.callImg.innerHTML = `<img style="height:60px; margin-bottom:-15px;" alt="Photo of ${ranger.fullName || ranger.callsign}" src="${src}"/>`
      this.callInfo.innerHTML = `<span class="enter__Callsign-info">${ranger.fullName}<br> ${ranger.phone}<br>${ranger.id ? ranger.id : "No id - not checked in"}</span>`

    } else {
      this.log.warn(`EntryForm CallsignChanged did not find enter__Callsign-image or enter__Callsign-upshot`, this.id)
    }
  }

  /**
   * Save entries to Reports data storage...
   *
   * Ensure we have obtained values from child components (timePicker & location) to persist/submit
   *
   * @param formData1
   *
   */
  onFormSubmit(): void {
    this.log.excessive(`Submit Form`, this.id)

    // NOTE: Afterward, we will just reset the form. Otherwise (if reusing the form) create a deep copy of the form-model:
    // result.entryDetailsForm = Object.assign({}, result.entryDetailsForm)

    /* FUTURE: Allow keywords, or search Notes for semicolon delimited tokens?
    get keywordsControls(): any {
    return (<FormArray>this.entryDetailsForm.get('keywords')).controls
    }   */

    let formDataJSON = JSON.stringify(this.mergedFormValue())

    let newReport = this.radioLogService.addRadioLogEntry(formDataJSON)
    this.log.info(`Report id # ${newReport.id} has been added with: ${formDataJSON} `, this.id)

    if (this.submitInfo) {
      // The KEPT confirmation: a fading line beside the Submit button, right where the
      // scribe's attention already is. Maintainer, 2026-08-26: "save the lower fading
      // report". Shows the id alone by default - the full JSON dump it used to always
      // append is raw diagnostic data, so it now rides along only in debug mode, matching
      // the #enter__frm-reguritation panel's own gating in ngOnInit above.
      this.submitInfo.innerText = this.settings?.debugMode
        ? `Entry id # ${newReport.id} Saved. Data: ${formDataJSON}`
        : `Entry id # ${newReport.id} saved`
      Utility.resetMaterialFadeAnimation(this.submitInfo)
    }
    else {
      this.log.error("Submit Info field not found. Could not display report confirmation confirmation", this.id)
    }

    // Debug-mode only, as of 2026-08-26. This is the snackbar that lands at the TOP of the
    // page (AlertsComponent.OpenSnackBar passes verticalPosition: 'top'), and it dumped the
    // entire serialized report over the page header on every single submit - the maintainer
    // asked for it to be debug-only: "the fading display at TOP of the page, once submit is
    // clicked, should only happen if debug mode is on." The lower fading line above is the
    // one a scribe actually needs, and it stays unconditional.
    if (this.settings?.debugMode) {
      this.alert.OpenSnackBar(`Entry id # ${newReport.id} Saved: ${formDataJSON} `, `Entry id # ${newReport.id} `, 3000)
    }

    this.resetEntryForm()  // std reset just blanks values, doesn't initialize the various form fields...
  }

  ngOnDestroy() {
    //this.locationChange?.unsubscribe()
    this.rangersSubscription?.unsubscribe()
    this.missionSubscription?.unsubscribe()
    //this.timeSubscription?.unsubscribe()
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
  }
}
