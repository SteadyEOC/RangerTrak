import { ColDef, GridOptions } from 'ag-grid-community'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../shared/overdue'
//import { TooltipModule } from 'ng2-tooltip-directive'
import { Subscription } from 'rxjs'

import { CommonModule, DOCUMENT } from '@angular/common'
import { AfterViewInit, Component, Inject, OnDestroy, OnInit, ViewChild, ChangeDetectionStrategy, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { RouterLink } from '@angular/router'
import { AgGridAngular } from 'ag-grid-angular';
import { GuideService } from '../shared/guide/guide.service';
import { PageComponent } from '../shared/page/page.component';
import { MATERIAL_IMPORTS } from '../material-imports';

import { Utility } from '../shared'
import { ensureAgGridRegistered } from '../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../shared/ag-grid-theme'
import { AlertsComponent } from '../shared/alerts/alerts.component'
import { ExpandableSectionComponent } from '../shared/expandable-section/expandable-section.component'
import { formatReportTime } from '../shared/mapping/report-time'
import {
  RadioLogService, RadioLogEntryType, LogService, RangerService, RangerType,
  MissionService, MissionType, SampleDataService
} from '../shared/services'
// Direct path, not the barrel: importing a service used as a DI token through
// shared/services/index.ts leaves it unresolvable to the compiler ("no suitable injection
// token"), the same way the barrel broke `imports:` arrays during Sprint B.
import { RangerPhotoService } from '../shared/services/ranger-photo.service'
// Direct path too - plain type/const exports, but kept alongside the barrel import above
// would mean splitting SampleDataService out of it for no real benefit.
import { DEFAULT_SAMPLE_SCENARIO, SAMPLE_SCENARIOS, SampleScenarioId } from '../shared/services/sample-data.service'
import { extractMissionZip, MissionZipManifest, MissionZipPhoto } from '../shared/export/mission-zip'
import { mergeRangers } from '../shared/services/ranger-migration'
import { CustomTooltip } from './customTooltip'


@Component({
  selector: 'rangertrak-rangers',
  standalone: true,
  imports: [CommonModule, AgGridAngular, PageComponent, ExpandableSectionComponent, RouterLink, ...MATERIAL_IMPORTS],
  templateUrl: './rangers.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./rangers.component.scss']
})
export class RangersComponent implements OnInit, AfterViewInit, OnDestroy {

  private id = 'Ranger Component'
  title = 'Rangers & Teams'
  pageDescr = `Grid display of rangers & teams on this mission`

  private rangersSubscription!: Subscription
  // Mutated inside the rangersSubscription's subscribe() callback, not an Angular
  // template binding - this app is zoneless, so a plain field written there has no
  // guaranteed path back into change detection. Signals close that gap (Sprint G).
  public rangers = signal<RangerType[]>([])

  private radioLogSubscription!: Subscription
  // "Not checked in" column: the most recent field report date per ranger, keyed
  // `rangerUid || callsign` - same join key drawTrails()/displayMarkers() use (ADR D-42
  // phase 5). Read by lastContactCellRenderer/lastContactValueGetter below, not a signal -
  // ag-grid's cellRenderer/valueGetter are plain functions re-invoked on refreshCells(),
  // so this only needs to be current when the grid actually redraws, not push its own
  // change detection. Deliberately recomputed only when field reports change (grid refresh
  // triggered below), not on a setInterval - same "computed once when this method runs, not
  // a live-updating clock" choice mapLeaflet.component.ts's drawTrails() elapsed-time
  // readout already made, for the same reason: it goes stale until the next redraw rather
  // than ticking on its own.
  private lastContactByKey = new Map<string, Date>()

  // Material-M3 pass, 2026-08-26: the CSV export controls' state, replacing two
  // getElementById reads - see getSeperatorValue()/onBtnExportToExcel() below for what each
  // would have done post-conversion (one throws, one silently exports the wrong rows).
  /** CSV column separator: 'none' (comma), 'tab', or a literal character. */
  public columnSeparator = signal('none')
  /** Export all rows, rather than only the filtered/sorted ones. */
  public allRows = signal(false)

  /** Options for the CSV separator picker: [stored value, label shown to the user]. */
  readonly separatorOptions: { value: string; label: string }[] = [
    { value: 'none', label: 'comma (,)' },
    { value: 'tab', label: 'tab' },
    { value: '|', label: 'bar (|)' },
  ]

  private missionSubscription!: Subscription
  private settings!: MissionType

  alert: any

  // The confidentiality bar above the roster. Dismissal is remembered per browser, which
  // is the point - it used to be a permanent block that pushed the grid down the page on
  // every visit, and a warning that cannot be acknowledged is a warning people learn to
  // read past. Dismissing it hides the *bar*; the full notice stays in the "Privacy &
  // data handling" section below and cannot be removed.
  //
  // Deliberately its own localStorage key rather than a field on the settings object:
  // this is a per-device UI acknowledgement, not mission data, and it must not ride along
  // in Mission Export or trigger the settings migration 24e is tracking.
  private static readonly PRIVACY_DISMISSED_KEY = 'rangertrak.rangers.privacyNoticeDismissed'
  privacyNoticeDismissed = false


  numSeperatorWarnings = 0
  maxSeperatorWarnings = 3

  now: Date

  // https://www.ag-grid.com/angular-data-grid/grid-interface/#grid-options-1
  private gridApi: any
  private gridColumnApi: any

  gridOptions: GridOptions = {
    // PROPERTIES
    theme: rangertrakGridTheme,
    // v32.2+ object form - see the equivalent comment in field-reports.component.ts.
    rowSelection: {
      mode: 'multiRow',
      checkboxes: false,
      headerCheckbox: false,
      enableClickSelection: true,
    },
    // pagination: true,

    // EVENT handlers
    // onRowClicked: event => this.log.verbose('A row was clicked'),
    // onSelectionChanged: (event: SelectionChangedEvent) => this.onRowSelection(event),

    // CALLBACKS
    // getRowHeight: (params) => 25
    //},

    // E-104 (2026-08-25): same content-based sizing as the Field Reports grid - see
    // field-reports.component.ts for the full reasoning. On this grid the symptom was
    // `ID` and `Notes` holding "(none set)" and "-" in ~290px columns while `Call Sign`
    // and `Full Name` were squeezed.
    autoSizeStrategy: { type: 'fitCellContents' },

    defaultColDef: {
      // flex removed - it made every column flexible, which disables autoSizeStrategy.
      // Exactly one column (Notes) opts back in, to absorb the leftover width.
      minWidth: 60,
      editable: true,
      //singleClickEdit: true,
      resizable: true,
      sortable: true,
      filter: true,
      floatingFilter: true,
      tooltipComponent: CustomTooltip,
    },
    tooltipShowDelay: 0,
    tooltipHideDelay: 2000,
    // set rowData to null or undefined to show loading panel by default
    rowData: null,
  };

  // On hovering, display a larger image!
  //
  // Photo resolution order (E-38):
  //   1. a photograph stored on THIS device, keyed by id or callsign (D-42 phase 6) -
  //      never in the repo (D-35)
  //   2. whatever `image` the roster names, under the configured image directory
  //   3. the generic androgynous silhouette
  // Step 3 matters: before it, a ranger with no photo rendered a broken-image icon.
  imageCellRenderer = (params: { data: RangerType }) => {
    const src = this.photoSrc(params.data)
    return `<img class="licenseImg" style="height:40px; width:40px;" alt="Photo of ${params.data.fullName || params.data.callsign}"
      src="${src}">`
  }

  /** Shared by the renderers above - see the resolution order there. */
  photoSrc(ranger: RangerType): string {
    const local = this.photos.photoUrl(ranger)
    if (local) return local
    if (ranger.image) return `${this.settings.imageDirectory}rangers/${ranger.image}`
    return `${this.settings.imageDirectory}rangers/androgynous.svg`
  }

  // D-42 phase 7: a blank callsign is no longer a defect - plenty of CERT/MERT responders
  // are not ham-licensed, and a resolvable `id` (or the internal `uid`) carries the join
  // now, not callsign. The "⚠ (none set)" treatment this cell used to own moves to
  // idCellRenderer below, since a blank `id` ("hasn't checked in yet") is the state that
  // actually leaves a report unattributable.
  callsignCellRenderer = (params: { data: RangerType }) => {
    let title = `${params.data.fullName} | ${params.data.phone}`
    return `<span aria-hidden title="${title}"> ${params.data.callsign}</span>`
  }

  idCellRenderer = (params: { data: RangerType }) => {
    // Same #c0392b as the map's UNASSIGNED_MARKER (ranger-icon.ts) so the two read as one
    // signal, not two different warnings, wherever an operator sees either.
    if (!params.data.id?.trim()) {
      return `<span aria-hidden title="No id set - not checked in yet, or no credential on file. Field reports from this ranger can't be attributed by id until one is." style="color:#c0392b;font-weight:700"> ⚠ (none set)</span>`
    }
    return `<span aria-hidden> ${params.data.id}</span>`
  }

  /** Same grouping key drawTrails()/displayMarkers() use (ADR D-42 phase 5): `rangerUid`
   * when set, `callsign` as the fallback for reports filed before D-42 or against a
   * callsign matching no current roster row. Only the newest report per key survives. */
  private static buildLastContactByKey(reports: RadioLogEntryType[]): Map<string, Date> {
    const byKey = new Map<string, Date>()
    reports.forEach(r => {
      const key = r.rangerUid || r.callsign
      if (!key) return
      const date = new Date(r.date)
      const existing = byKey.get(key)
      if (!existing || date > existing) byKey.set(key, date)
    })
    return byKey
  }

  private lastContactFor(ranger: RangerType): Date | null {
    return this.lastContactByKey.get(ranger.uid || ranger.callsign) ?? null
  }

  /** Sortable underlying value for the "Last Contact" column - epoch ms, or null for a
   * ranger with no field report on file yet ("not checked in"). */
  lastContactValueGetter = (params: { data: RangerType }) => {
    return this.lastContactFor(params.data)?.getTime() ?? null
  }

  // Same #c0392b "not attributable yet" red idCellRenderer uses below, for the same reason:
  // this is the other half of "can this ranger's activity be tracked at all right now."
  lastContactCellRenderer = (params: { data: RangerType }) => {
    const last = this.lastContactFor(params.data)
    if (!last) {
      return `<span aria-hidden title="No field report received yet from this ranger." `
        + `style="color:#c0392b;font-weight:700">`
        + `<i class="material-icons" aria-hidden="true" `
        + `style="font-size:18px;width:18px;height:18px;vertical-align:text-bottom;">phone_disabled</i>`
        + ` not checked in</span>`
    }
    // E-118 (2026-09-22): the same overdue ramp the map has always had, now here too - this
    // grid is where a scribe actually scans for a team that has gone quiet, and it used to
    // show the time as plain text with no warning at all. Band 0 (not due yet) adds no
    // class, so a healthy roster looks exactly as it did before.
    const elapsed = elapsedMinutes(last)
    const band = overdueBand(elapsed, this.settings?.checkInIntervalMin ?? DEFAULT_CHECK_IN_INTERVAL_MIN)
    const cls = band > 0 ? ` class="rt-elapsed rt-elapsed--${band}"` : ''
    const overdueNote = band > 0 ? ` - ${elapsed} min ago, overdue` : ''
    return `<span${cls} aria-hidden title="Last report received: ${last.toLocaleString()}${overdueNote}">`
      + `${formatReportTime(last)}</span>`
  }

  // Raised live, 2026-08-27: what to CALL a ranger's unique id varies by agency/region
  // (settings.idFieldLabel, MissionType) - WA uses REW, other agencies use something else
  // entirely. This is a method, not a static array, so it can rebuild with a new
  // headerName whenever settings change (see the settings subscription in ngOnInit) - AG
  // Grid's Angular wrapper picks up a NEW columnDefs array reference reactively, so
  // reassigning `this.columnDefs` here is enough, no grid API call needed.
  private buildColumnDefs(idFieldLabel: string): ColDef[] {
    return [
      // F29-12 (2026-08-29): Image first, then the mission's identity field, then callsign -
      // matches the order a scribe actually scans a roster row in.
      // Fixed: the cell renders a 40x40 <img>, so measuring its content is pointless -
      // it is always exactly one thumbnail wide.
      { headerName: "Image", field: "image", cellRenderer: this.imageCellRenderer, tooltipField: "image", tooltipComponentParams: { color: '#ececec' }, width: 80, maxWidth: 80, resizable: false },
      { headerName: idFieldLabel || 'ID', field: "id", cellRenderer: this.idCellRenderer, singleClickEdit: true, maxWidth: 170 },
      { headerName: "Call Sign", field: "callsign", cellRenderer: this.callsignCellRenderer, minWidth: 110, maxWidth: 200 },
      { headerName: "Full Name", field: "fullName", tooltipField: "FCC Licensee Name", minWidth: 150, maxWidth: 300 },
      { headerName: "Phone", field: "phone", singleClickEdit: true, maxWidth: 170 },
      { headerName: "Role", field: "role", maxWidth: 200 },
      {
        headerName: "Last Contact", colId: "lastContact",
        valueGetter: this.lastContactValueGetter, cellRenderer: this.lastContactCellRenderer,
        editable: false, minWidth: 150, maxWidth: 220,
      },
      // The only flex column - takes whatever the content-sized columns leave over.
      { headerName: "Notes", field: "note", flex: 1, minWidth: 150 },
    ]
  }

  columnDefs: ColDef[] = this.buildColumnDefs('ID')

  constructor(
    //private teamService: TeamService,
    private log: LogService,
    private rangerService: RangerService,
    private missionService: MissionService,
    private radioLogService: RadioLogService,
    private photos: RangerPhotoService,
    private sampleDataService: SampleDataService,
    private _snackBar: MatSnackBar,
    // The confidentiality bar's "What this means" opens the Guide drawer's Privacy tab -
    // see openPrivacyDetails().
    private guide: GuideService,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.log.info(`======== Constructor() ============`, this.id)
    ensureAgGridRegistered()

    this.now = new Date()
    this.gridApi = ""
    this.gridColumnApi = ""
  }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  ngOnInit(): void {

    this.privacyNoticeDismissed =
      localStorage.getItem(RangersComponent.PRIVACY_DISMISSED_KEY) === 'true'

    this.alert = new AlertsComponent(this._snackBar, this.log, this.missionService, this.document) // TODO: Use Alert Service to avoid passing along doc & snackbar as parameters!
    //this.teamService = teamService
    //this.rangerService = rangerService

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.columnDefs = this.buildColumnDefs(newMission.idFieldLabel)
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('Settings Subscription complete', this.id)
    })

    this.rangersSubscription = this.rangerService.getRangersObserver().subscribe({
      next: (newRangers) => {
        this.rangers.set(newRangers)
        this.log.verbose('Received new Rangers via subscription.', this.id)
      },
      error: (e) => this.log.error('Rangers Subscription got:' + e, this.id),
      complete: () => this.log.info('Rangers Subscription complete', this.id)
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (reports) => {
        this.lastContactByKey = RangersComponent.buildLastContactByKey(reports.logEntries)
        this.refreshGrid()
        this.log.verbose('Received new Field Reports via subscription.', this.id)
      },
      error: (e) => this.log.error('Field Reports Subscription got:' + e, this.id),
      complete: () => this.log.info('Field Reports Subscription complete', this.id)
    })

    this.log.verbose(`ngInit: ${this.rangers().length} Rangers retrieved from Local Storage`, this.id)

    if (this.rangers().length < 1) {
      this.alert.Banner("No Rangers have been entered yet. Go to the bottom & click on 'Advanced' to resolve.")
      //this.alert.OpenSnackBar(`No Rangers found. Please enter them into the grid and then use the Update button,  or provide a Rangers.JSON file to import from or FUTUREE: Import them from an Excel file.`, `Nota Bene`, 1000)
    } else {
      //this.alert.OpenSnackBar(`Imported "${this.rangers().length}" rangers.`, `Nota Bene`, 1000)
    }

    if (!this.settings?.debugMode) {
      //this.displayHide("rangers__Fake")
      //this.displayHide("ranger__ImportExcel")
    }
  }

  /**
   * Called once all HTML elements have been created
   */
  ngAfterViewInit() {

  }

  //--------------------------------------------------------------------------

  onGridReady = (params: any) => {
    this.gridApi = params.api;
    this.gridColumnApi = params.columnApi;

    // E-104: sizeColumnsToFit() removed - it distributes grid width evenly and ignores
    // per-column flex, which is what squeezed Call Sign while ID sat half empty.
    // autoSizeStrategy in gridOptions handles sizing from content instead.
    // TODO: use this line, or next routine?!
    if (this.gridApi) {
      this.gridApi.refreshCells()
    } else {
      this.log.verbose("no this.gridApi yet in ngOnInit()", this.id)
    }
  }

  onFirstDataRendered(params: any) {
    // E-104: autoSizeStrategy already sized these from content by the time this fires.
    if (this.gridApi) {
      this.gridApi.refreshCells()
    } else {
      this.log.verbose("no this.gridApi yet in ngOnInit()", this.id)
    }
  }

  //--------------------------------------------------------------------------

  onBtnAddRanger(formData?: string) {
    this.log.verbose("Adding new ranger", this.id)
    this.rangerService.AddRanger()  // this calls updateLocalStorageAndPublish
    this.refreshGrid()
    this.reloadPage()
  }

  /** Scenario picker for "Load sample mission" below - see SAMPLE_SCENARIOS' own comment. */
  readonly sampleScenarios = SAMPLE_SCENARIOS
  selectedScenario = signal<SampleScenarioId>(DEFAULT_SAMPLE_SCENARIO)

  /**
   * "Load sample mission" from the empty-state block (see rangers.component.html) - the
   * same destructive action Mission > Advanced options offers
   * (mission-advanced-options.component.ts's onBtnLoadSampleData()), reached from here too
   * since an empty roster is precisely the moment this is most useful. The actual data
   * lives in SampleDataService; this only owns the confirm/reload wrapper, matching that
   * component's own copy so the same action reads the same way from either entry point.
   */
  async onBtnLoadSampleMission(): Promise<void> {
    const scenario = this.selectedScenario()
    const label = this.sampleScenarios.find(s => s.id === scenario)?.label ?? scenario

    if (!confirm(`Load the "${label}" sample mission?\n\n`
      + `This REPLACES all rangers, field reports and locations currently on this device with `
      + `demonstration data, renames the mission to make that obvious, and moves the mission's `
      + `default location to the demo's command post.\n\n`
      + `This cannot be undone - back up the current mission first if you want to keep it.`)) {
      this.log.verbose('onBtnLoadSampleMission: user cancelled.', this.id)
      return
    }

    await this.sampleDataService.loadSampleMission(scenario)
    this.log.warn(`Loaded the sample mission (demo data): ${scenario}.`, this.id)
    alert('Sample mission loaded. Reloading to refresh every screen with the new data...')
    this.reloadPage()
  }

  // ADR D-43: takes the surrogate uid, not a callsign - a blank or duplicated callsign could
  // otherwise delete the wrong row. No UI caller today; kept as the obvious hook for a
  // per-row delete on the grid.
  onBtnDeleteRanger(uid: string) {
    this.log.verbose(`onBtnDeleteRanger: deleting ranger with uid: ${uid}`, this.id)
    this.rangerService.deleteRangerByUid(uid)
  }

  onBtnDeleteRangers() {
    this.log.verbose(`onBtnDeleteRangers: Deleteing all rangers`, this.id)
    // Was: "REALLY delete all Rangers in LocalStorage, vs. edit the Ranger grid & Update
    // the values in Local Storage?" - which asked the operator to weigh an alternative
    // they had not chosen, in storage jargon, and never said what would actually happen.
    const count = this.rangerService.rangers.length
    if (Utility.getConfirmation(
      `Delete all ${count} rangers from this browser?\n\n`
      + `The roster will be empty until you import one or add station callsigns. `
      + `Field reports already filed are not deleted, but they will refer to callsigns `
      + `that are no longer in the roster.\n\n`
      + `Export the roster first if you might want it back.`)) {
      this.log.info("Removing all rangers from local storage...", this.id)
      this.rangerService.deleteAllRangers()
      this.refreshGrid()
      this.reloadPage()
    }
  }

  //--------------------------------------------------------------------------
  onDeselectAll() {
    this.log.verbose(`onDeselectAll: Deleteing all rangers`, this.id)
    this.gridApi.deselectAll()
  }

  onBtnUpdateLocalStorage() {
    this.log.verbose(`onBtnUpdateLocalStorage: saving the edited roster to local storage`, this.id)
    this.rangerService.updateLocalStorageAndPublish()
  }

  //--------------------------------------------------------------------------
  // Roster import / export (JSON)
  //
  // The roster is the one thing a team must bring with them, and until now the only way
  // in was Restore mission - which also replaces settings and every field report. That is
  // the wrong tool for "here is our roster": it discards the work already on the device.
  // These two do the roster and nothing else.

  /**
   * Imports rangers from a `.zip` handed to "Import roster" - a Setup file (E-109 v2, same
   * shape `/prep` builds and reads: `mission-zip.json` plus an optional `photos/`), not this
   * component's own bespoke `roster.json`+`photos/` shape any more. Retired 2026-08-31: three
   * different zip shapes for "roster and photos" had drifted apart (see mission-zip.ts's own
   * header comment on why), and this component already had to special-case detecting the OTHER
   * shape and redirect to `/prep` - that redirect is gone now that this path can just read it
   * directly.
   *
   * Applies ONLY the rangers, matching this button's own long-standing scope ("roster and
   * nothing else") - a settings or locations category the file might also carry is silently
   * ignored, not prompted about (prompting about the ignored part would resurrect exactly the
   * confusion the old redirect used to paper over). Rangers MERGE into what is already on this
   * device (`mergeRangers()`), the same additive semantics `/prep` itself uses - the safer
   * default even for an old-style Mission Zip that was built expecting a wholesale replace.
   */
  private async importRosterFromZip(file: File) {
    let manifest: MissionZipManifest
    let photos: MissionZipPhoto[]
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      ;({ manifest, photos } = extractMissionZip(bytes))
    } catch (error: any) {
      this.log.error(`Could not read ${file.name} as a Setup file: ${error.message}`, this.id)
      alert(`Could not read "${file.name}".\n\n${error.message}`)
      return
    }

    if (!manifest.rangers) {
      alert(`"${file.name}" does not carry a Rangers category - there is nothing here for `
        + `Import roster to apply. If it carries locations or settings instead, use the `
        + `Setup files page (/prep) to load those.`)
      return
    }

    const current = this.rangerService.rangers.length
    const warnings = this.rangerService.rosterWarnings(manifest.rangers)
    warnings.forEach(w => this.log.warn(`Setup file import warning (${file.name}): ${w}`, this.id))
    const merge = mergeRangers(this.rangerService.rangers, manifest.rangers)

    const otherCategories = [manifest.settings && 'mission settings', manifest.locations && 'locations']
      .filter((c): c is string => !!c)

    if (!confirm(
      `Import rangers from "${file.name}"?\n\n`
      + `  ${merge.added.length} new, ${merge.overwritten.length} updated\n\n`
      + (warnings.length ? `Note:\n  - ${warnings.join('\n  - ')}\n\n` : '')
      + `This MERGES into the current roster of ${current} - a matching row is updated, `
      + `everything else already here is kept. Field reports and settings are not affected.\n\n`
      + (otherCategories.length
        ? `This file also carries ${otherCategories.join(' and ')} - Import roster does not `
        + `apply those; use the Setup files page (/prep) for the whole file.\n\n`
        : '')
      + `Photos are stored on this device only.`)) {
      this.log.verbose('importRosterFromZip: user cancelled.', this.id)
      return
    }

    this.rangerService.replaceAllRangers(merge.rangers)

    const files = photos.map(p =>
      new File([p.bytes as BlobPart], p.filename, { type: this.mimeFor(p.filename) }))
    const { stored, unmatched } = await this.photos.importFiles(files, merge.rangers)

    this.log.warn(`Imported from ${file.name}: ${merge.added.length} new rangers, `
      + `${merge.overwritten.length} updated, ${stored.length} photos.`, this.id)

    const lines = [`Imported from "${file.name}": ${merge.added.length} new rangers, `
      + `${merge.overwritten.length} updated, ${stored.length} photos stored.`]
    if (unmatched.length) {
      lines.push('', `${unmatched.length} photo${unmatched.length === 1 ? '' : 's'} did not match a callsign and were skipped.`)
    }
    lines.push('', 'Reloading so every screen picks them up...')
    alert(lines.join('\n'))
    this.reloadPage()
  }

  private mimeFor(name: string): string {
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
    return ext === 'png' ? 'image/png'
      : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
          : ext === 'svg' ? 'image/svg+xml'
            : 'image/jpeg'
  }

  /**
   * Stores photographs on this device, matched to rangers by filename = id or callsign
   * (D-42 phase 6: id checked first, callsign as a fallback for older bundles).
   * They never enter the repo or a server (D-35); they are operator data.
   */
  async onPhotoFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])]
    input.value = ''
    if (!files.length) {
      return
    }

    const { stored, unmatched } = await this.photos.importFiles(files, this.rangerService.rangers)

    const lines = [`Stored ${stored.length} photo${stored.length === 1 ? '' : 's'} on this device.`]
    if (unmatched.length) {
      lines.push('',
        `${unmatched.length} did not match a ranger's id or callsign in the roster and were skipped:`,
        unmatched.slice(0, 8).join(', ') + (unmatched.length > 8 ? ', ...' : ''),
        '',
        'Photos are matched by filename: NAME the file after the ranger\'s id or callsign, e.g. "K7VMI.jpg".')
    }
    alert(lines.join('\n'))
    this.reloadPage()
  }

  /** Forgets every stored photo on this device. The roster itself is untouched. */
  async onBtnClearPhotos() {
    // F29-13: this used to unconditionally promise "the generic silhouette" afterward -
    // false whenever a ranger has a roster-declared `image` (photoSrc()'s tier 2, above).
    // Clearing this device's photo store correctly leaves that source untouched, so those
    // rangers keep showing their roster image, not the silhouette - the dialog just used to
    // lie about it, which read as "Clear photos doesn't clear" even though it had.
    if (!Utility.getConfirmation(
      `Delete all ${this.photos.count()} ranger photos stored on this device?\n\n`
      + `The roster is not affected. Rangers with no photo of their own will show the `
      + `generic silhouette until you import photos again - rangers whose roster entry `
      + `already names an image will keep showing that instead.`)) {
      return
    }
    await this.photos.clear()
    this.reloadPage()
  }

  /**
   * Downloads the roster as JSON - the file the importer below expects.
   *
   * Raised live 2026-08-31: with a partial grid selection active, this always exported the
   * WHOLE roster regardless - easy to miss for anyone who selected a handful of rows to check
   * something, then hit Export expecting just those. A full selection (or none at all) exports
   * everything with no prompt, same as before; only a genuine partial selection asks which one
   * is wanted, since that's the one case "export everything" might not be what was intended.
   */
  onBtnExportRangersJson() {
    const all = this.rangerService.rangers
    if (!all.length) {
      alert('There are no rangers to export.')
      return
    }

    const selected: RangerType[] = this.gridApi?.getSelectedRows?.() ?? []
    const exportSelected = selected.length > 0 && selected.length < all.length
      && confirm(
        `${selected.length} of ${all.length} rangers are selected.\n\n`
        + `OK: export just the ${selected.length} selected.\n`
        + `Cancel: export all ${all.length}.`)
    const rangers = exportSelected ? selected : all

    const json = JSON.stringify({ rangers }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().slice(0, 10)

    const a = this.document.createElement('a')
    a.href = url
    a.download = `rangertrak-roster-${stamp}${exportSelected ? '-selected' : ''}.json`
    a.click()
    URL.revokeObjectURL(url)

    this.log.info(`Exported ${rangers.length} rangers as JSON${exportSelected ? ' (selection)' : ''}.`, this.id)
  }

  /**
   * Handles a file picked via "Import roster". Replaces the roster only; field reports
   * and settings are untouched, which is the whole point of it being separate from
   * Restore mission.
   */
  onRosterFileSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event

    if (!file) {
      return
    }

    // A .zip is a Setup file (E-109 v2): roster AND photos in one action. The two-step
    // (import roster, then multi-select the photos) still works, but handing a volunteer
    // one file to pick is the difference between a setup that happens and one that does
    // not.
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      this.importRosterFromZip(file)
      return
    }

    const reader = new FileReader()

    reader.onerror = () => {
      this.log.error(`onRosterFileSelected: could not read ${file.name}`, this.id)
      alert(`Could not read "${file.name}".`)
    }

    reader.onload = () => {
      let incoming: RangerType[]
      try {
        incoming = this.rangerService.parseRosterJson(reader.result as string)
      } catch (error: any) {
        this.log.error(`onRosterFileSelected: ${file.name} rejected: ${error.message}`, this.id)
        alert(`Could not import "${file.name}".\n\n${error.message}`)
        return
      }

      const current = this.rangerService.rangers.length
      const warnings = this.rangerService.rosterWarnings(incoming)
      warnings.forEach(w => this.log.warn(`Roster import warning (${file.name}): ${w}`, this.id))

      if (!confirm(
        `Import ${incoming.length} rangers from "${file.name}"?\n\n`
        + (warnings.length ? `Note:\n  - ${warnings.join('\n  - ')}\n\n` : '')
        + `This REPLACES the current roster of ${current}. `
        + `Field reports and settings are not affected.\n\n`
        + `Tip: use "Export roster (JSON)" first if you want to keep the current one.`)) {
        this.log.verbose('onRosterFileSelected: user cancelled import.', this.id)
        return
      }

      this.rangerService.replaceAllRangers(incoming)
      this.log.warn(`Imported ${incoming.length} rangers from ${file.name}.`, this.id)
      alert(`Imported ${incoming.length} rangers. Reloading so every screen picks them up...`)
      this.reloadPage()
    }

    reader.readAsText(file)
  }


  //--------------------------------------------------------------------------
  // Removed: onBtnImportJson / onBtnImportExcel / onBtnImportExcel2 / onFileChange /
  // import / export / read / write. They were SheetJS demo code and half-finished
  // experiments - the JSON one read the file into a data URL and threw it away, the
  // Excel ones imported the wrong sheet or alerted "NOT IMPLEMENTED" - all shown in
  // the UI behind a "may not work" disclaimer. Importing a roster is what
  // BackupService's Restore mission does, for real (Roadmap Section 18/E).

  //--------------------------------------------------------------------------
  onBtnReloadPage() {
    this.reloadPage()
  }

  reloadPage() {
    this.log.verbose(`Reloading window!`, this.id)
    window.location.reload()
  }

  refreshGrid() {
    if (this.gridApi) {
      this.gridApi.refreshCells()
      // E-104: was sizeColumnsToFit(), which undid the content sizing after every edit.
      this.gridApi.autoSizeAllColumns()
    } else {
      this.log.verbose("no this.gridApi yet in refreshGrid()", this.id)
    }
  }

  //--------------------------------------------------------------------------
  // following from https://ag-grid.com/javascript-data-grid/csv-export/
  onBtnExportToExcel() {
    //var params = this.getParams();
    //this.log.verbose(`Got column seperator value "${params.columnSeparator}"`, this.id)
    //this.log.verbose(`Got filename of "${params.fileName}"`, this.id)
    //this.gridApi.exportDataAsCsv(params);

    // Confirm before the roster leaves the app: the exported file carries names, personal
    // phone numbers and call signs in the clear, and nothing this app does can protect it
    // afterwards.
    if (!Utility.getConfirmation(
      `Export the roster to a file?\n\n`
      + `The exported file contains PERSONAL INFORMATION - legal names, `
      + `personal phone numbers and call signs - and is NOT encrypted.\n\n`
      + `Store it somewhere appropriate, share it only with people who need it for this `
      + `mission, and delete it when the mission is over.`)) {
      this.log.verbose('onBtnExportToExcel: user cancelled export.', this.id)
      return
    }

    // ! Is this JUST for enterprise edition?! - test...
    // https://www.ag-grid.com/javascript-data-grid/excel-export-rows/#export-all-unprocessed-rows
    // Material-M3 pass, 2026-08-26: reads the signal below, not
    // `getElementById('allRows').checked` - `<mat-checkbox>` puts its real input several
    // levels inside its own template, so that id now lands on the host, where `.checked` is
    // `undefined` and therefore falsy. The old read would have silently exported
    // 'filteredAndSorted' every time regardless of the box. Same fix as field-reports'.
    this.gridApi.exportDataAsExcel({
      exportedRows: this.allRows() ? 'all' : 'filteredAndSorted',
    })
  }

  /**
   * Material-M3 pass, 2026-08-26: reads the signal below rather than a native `<select>`.
   * `<mat-select>` renders no native `<select>` element, so the previous
   * `getElementById(...) as HTMLSelectElement` + `.selectedIndex`/`.options` read would
   * have thrown once the control was converted. Same change as field-reports'.
   */
  getSeperatorValue(inputSelector: string) {
    const selVal = this.columnSeparator()

    switch (selVal) {
      case 'none':
        return;
      case 'tab':
        return '\t';
      default:
        return selVal;
    }
  }

  getParams() {
    let dt = new Date()
    return {
      columnSeparator: this.getSeperatorValue('columnSeparator'),
      fileName: `RangersExport.${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}_${dt.getHours()}:${dt.getMinutes()}.csv`, // ONLY month is zero based!
    }
  }

  onSeperatorChange() {
    var params = this.getParams();
    if (params.columnSeparator && this.numSeperatorWarnings++ < this.maxSeperatorWarnings) {
      //this.alerts.OpenSnackBar(`NOTE: Excel handles comma separators best. You've chosen "${params.columnSeparator}"`, `Nota Bene`, 4000)
      alert(`NOTE: Excel handles comma separators best. You've chosen "${params.columnSeparator}" Good luck!`);
    }
  }

  //--------------------------------------------------------------------------
  // Confidentiality bar

  dismissPrivacyNotice() {
    this.privacyNoticeDismissed = true
    try {
      localStorage.setItem(RangersComponent.PRIVACY_DISMISSED_KEY, 'true')
    } catch (e) {
      // Private-browsing or a full quota. The bar still goes away for this visit; it
      // simply comes back next time, which is the safe direction to fail in.
      this.log.warn(`Could not persist privacy-notice dismissal: ${e}`, this.id)
    }
  }

  /**
   * The confidentiality bar's "What this means". Used to scroll to a
   * `<rangertrak-section summary="Privacy & data handling">` further down this page; that
   * content moved into the Guide drawer in the Material-M3 pass (2026-08-25), so this now
   * opens the drawer straight to its Privacy tab rather than scrolling to a block that no
   * longer exists.
   */
  openPrivacyDetails() {
    this.guide.open('Privacy')
  }

  //--------------------------------------------------------------------------

  displayHide(htmlElementID: string) {
    let e = this.document.getElementById(htmlElementID)
    if (e) {
      e.style.visibility = "hidden";
    }
  }

  displayShow(htmlElementID: string) {
    let e = this.document.getElementById(htmlElementID)
    if (e) {
      e.style.visibility = "visible";
    }
  }


  ngOnDestroy() {
    this.rangersSubscription?.unsubscribe()
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
  }
}
