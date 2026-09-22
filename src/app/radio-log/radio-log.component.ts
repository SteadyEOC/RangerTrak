import { GridOptions, SelectionChangedEvent } from 'ag-grid-community'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../shared/overdue'
// , TeamService
import { Observable, subscribeOn, Subscription } from 'rxjs'

import { CommonModule, DOCUMENT, formatDate } from '@angular/common'
import { AfterViewInit, Component, Inject, OnDestroy, OnInit, Pipe, PipeTransform, ElementRef, ChangeDetectionStrategy, signal } from '@angular/core';

import { AgGridAngular } from 'ag-grid-angular';
import { PageComponent } from '../shared/page/page.component';
import { ExpandableSectionComponent } from '../shared/expandable-section/expandable-section.component';
import { MATERIAL_IMPORTS } from '../material-imports';

// 2026-09-02: also imported from its own file now, not the '../shared/' barrel - same
// reason as rangerColorFor below (the barrel re-exports ranger-icon.ts's Leaflet-typed
// functions too, and 'leaflet' has side effects esbuild can't tree-shake out of a barrel).
import { Utility } from '../shared/utility'
import { ensureAgGridRegistered } from '../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../shared/ag-grid-theme'
// Imported from its own file, not the '../shared/' barrel - that barrel also re-exports the
// MapLibre style helpers, and this route is already its own lazy chunk (loadComponent in
// app.routes.ts); going through the barrel would drag MapLibre into THIS chunk for no reason.
import { rangerColorFor } from '../shared/mapping/ranger-marker'
import { buildIcs309Log, Ics309Log } from '../shared/export/ics309-log'
import { parseReportPacket, REPORT_PACKET_SCHEMA_VERSION } from '../shared/export/report-packet'
import {
  RadioLogService, RadioLogStatusType, RadioLogType, RadioLogEntryType, LogService,
  RangerService, MissionService, MissionType, statusColorValue, statusInkValue
} from '../shared/services'

@Pipe({ name: 'myUnusedPipe' })
export class myUnusedPipe implements PipeTransform {
  transform(val: string) {
    return val.toUpperCase()
  }
}


// 2026-08-31: renamed from field-reports.component.ts / FieldReportsComponent - this file
// (and radio-log.service.ts/radio-log-entry.interface.ts alongside it) used to keep the
// original "Field Report" name deliberately, on the theory that renaming everywhere would be
// "pure churn" once only the page's own display label changed (0.75.0's ICS-309/213
// restructuring, Reports -> Radio Log). Revisited and reversed: the class/file/service names
// had become the exact stale-second-name problem the rest of that restructuring existed to
// fix.
@Component({
  selector: 'rangertrak-radio-log',
  standalone: true,
  imports: [
    CommonModule,
    AgGridAngular,
    PageComponent,
    ExpandableSectionComponent,
    ...MATERIAL_IMPORTS
  ],
  templateUrl: './radio-log.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./radio-log.component.scss']
})
export class RadioLogComponent implements OnInit, OnDestroy {

  private id = 'Radio Log'
  title = 'Radio Log — ICS-309'
  pageDescr = `Every field report, in one grid - who, where, when, and what they said.`

  private radioLogSubscription!: Subscription

  /**
   * Read through to the service rather than snapshotting in ngOnInit, which is what this
   * used to do. The statuses (and their colors) are per-mission settings, so Import
   * Mission, Load Sample Mission and Reset Settings all change them - and the snapshot
   * left this grid coloring rows by the *previous* mission's status list. Read at
   * cell-render time, so a getter is enough; MissionService.settings reads a signal.
   */
  private get radioLogStatuses(): RadioLogStatusType[] {
    return this.missionService.settings?.radioLogStatuses ?? []
  }
  // Mutated inside gotNewRadioLog(), reached from the radioLogSubscription's
  // subscribe() callback, not an Angular template binding - this app is zoneless, so a
  // plain field written there has no guaranteed path back into change detection.
  // Signals close that gap (Sprint G).
  public radioLogEntries = signal<RadioLogEntryType[]>([])
  private radioLog: RadioLogType | undefined

  private missionSubscription!: Subscription
  private settings!: MissionType

  // Mutated inside onRowSelection(), itself invoked from gridOptions.onSelectionChanged
  // - an ag-grid-native callback, not a template event binding. Same reasoning as above.
  public selectedRows = signal(0)

  // Material-M3 pass, 2026-08-26: the export controls' state, replacing three
  // getElementById reads (see getParamValue/onBtnExport below for why each had to go -
  // one would have thrown, one would have silently exported the wrong rows).
  /** CSV column separator: 'none' (comma), 'tab', or a literal character. */
  public columnSeparator = signal('none')
  /** Export all rows, rather than only the filtered/sorted ones. */
  public allRows = signal(false)
  /** Rows per page, as shown in the picker: 'Auto' | '5' | ... | 'All'. */
  public rowsPerPage = signal('Auto')

  /** Options for the rows-per-page picker - kept here so the template just iterates. */
  readonly rowsPerPageOptions = ['Auto', '5', '10', '25', '50', '100', 'All']

  /** Options for the CSV separator picker: [stored value, label shown to the user]. */
  readonly separatorOptions: { value: string; label: string }[] = [
    { value: 'none', label: 'comma (,)' },
    { value: 'tab', label: 'tab' },
    { value: '|', label: 'bar (|)' },
  ]

  // E-31/E-41 phase 3, piece 3 (2026-08-31): "Print 309" scope picker, exactly the three
  // options the roadmap's own scoping settled on ("all those since the last print, or ???" -
  // recommended and adopted: filtered/visible, selected, or since the last print).
  public printScope = signal<'visible' | 'selected' | 'sincePrint'>('visible')
  readonly printScopeOptions: { value: 'visible' | 'selected' | 'sincePrint'; label: string }[] = [
    { value: 'visible', label: 'Filtered & sorted rows shown now' },
    { value: 'selected', label: 'Selected rows' },
    { value: 'sincePrint', label: 'Since the last print' },
  ]
  // Read by the print-only block in the template (radio-log.component.html) - null
  // until "Print 309 Log" is clicked, so nothing renders under `@media print` before then.
  public ics309Log = signal<Ics309Log | null>(null)
  // NOT initialized here with `= this.buildColumnDefs('ID')` the way rangers.component.ts's
  // own columnDefs field is - that only works there because its cellRenderer fields are
  // declared BEFORE columnDefs (class field initializers run top-to-bottom at construction
  // time). This file's statusCellRenderer/notesCellRenderer/evidenceCellRenderer are declared
  // further down, so calling buildColumnDefs() from a field initializer here would capture
  // them as still-undefined. Built in ngOnInit instead, same as before this pass - by then
  // every field on the class is already assigned.
  public columnDefs!: any

  /**
   * Raised live, 2026-08-27, four fixes at once:
   *  - `id` (this report's own sequential number, NOT a ranger identifier - see
   *    RadioLogEntryType's own comment on the two) was headed "ID", easily confused with the
   *    ranger-identifier column two over. Renamed to "#", what it actually is: this row's
   *    line number in the radio log.
   *  - CallSign's text now colors by ranger identity via `rangerColorFor` - the exact same
   *    hash-based color already used for that ranger's map marker/trail (ranger-icon.ts),
   *    so the same person's reports are easy to pick out scanning down the column, and the
   *    color matches what a scribe already sees on the map for that ranger.
   *  - Address/Notes get `tooltipField`: AG Grid's own cell-level tooltip, which (unlike the
   *    native `title` on Notes' cellRenderer span, still left below) covers the WHOLE cell
   *    including the empty space past a truncated value, not just the visible characters
   *    themselves - the actual gap in "hovering doesn't show the full text."
   */
  private buildColumnDefs(): any[] {
    return [
      { headerName: "#", field: "id", headerTooltip: 'This report\'s line number in the radio log', maxWidth: 90, editable: false },
      // E-114 open question 5 (2026-08-31, decided: "yes, imported rows can have that
      // reflected"). Deliberately NOT the existing "Source" column below - that already means
      // the communications medium the report itself arrived over (Voice/Phone/Packet/APRS/
      // Email - RADIO_LOG_ENTRY_SOURCES literally has its own unrelated 'Packet' meaning ham
      // packet radio), a different axis entirely from "did this ROW arrive on THIS device via
      // a merge." No new field needed either: `sourceUid` is already stamped ONLY on a merged
      // entry (see RadioLogEntryType's own doc comment), so its mere presence already answers
      // the question - this column just surfaces it. Same "icon or blank" shape as the
      // Evidence column's own evidenceCellRenderer below.
      {
        headerName: "Origin", field: "sourceUid", maxWidth: 70, editable: false,
        cellRenderer: this.originCellRenderer,
        tooltipValueGetter: (params: { data: RadioLogEntryType }) =>
          params.data.sourceUid ? 'Merged in from a Report Packet - not typed on this device' : undefined,
      },
      // F29-44 (partial, 2026-08-29): headerName was `idFieldLabel || 'Callsign'` while field
      // stayed hardcoded "callsign" - a mission that renames its id field (e.g. to "REW")
      // rendered a column headed "REW" full of callsign data. Header now names what the
      // field actually holds. The collapse-when-callsign-is-the-key behavior (F29-44's other
      // half) is a separate, still-open decision - see the handoff doc.
      {
        headerName: 'Callsign', field: "callsign", tooltipField: "team", maxWidth: 160,
        cellStyle: (params: { data: RadioLogEntryType }) => {
          const key = params.data.rangerUid || params.data.callsign
          return key ? { color: rangerColorFor(key), 'font-weight': 600 } : null
        }
      },
      // { headerName: "Team", field: "team" },
      // Dot path, not "address": the address lives on the nested location object, exactly
      // as lat/lng do below. Bound to the wrong field, this column rendered blank for
      // every report - the addresses were in the data all along.
      // The column most often holding a long value, and the one that used to lose the
      // argument with Lat/Lng. A floor of 180px keeps it legible even when every visible
      // row happens to be a short address; the ceiling stops one 90-character address from
      // pushing Status and Notes off screen.
      {
        headerName: "Address", field: "location.address", singleClickEdit: true, minWidth: 180, maxWidth: 420,
        tooltipField: "location.address"
      },
      {
        // valueSetter, not just field: "lat" - the real value lives at location.lat,
        // so without this an edit wrote a phantom top-level `lat` that nothing reads
        // and the displayed coordinate snapped back on the next refresh.
        headerName: "Lat", field: "lat", singleClickEdit: true, cellClass: 'number-cell', maxWidth: 130,
        valueGetter: (params: { data: RadioLogEntryType }) => { return Math.round(params.data.location.lat * 10000) / 10000.0 },
        valueSetter: (params: { data: RadioLogEntryType, newValue: any }) => this.setCoordinate(params.data, 'lat', params.newValue)
      },
      {
        headerName: "Lng", field: "lng", singleClickEdit: true, cellClass: 'number-cell', maxWidth: 130,
        valueGetter: (params: { data: RadioLogEntryType }) => { return Math.round(params.data.location.lng * 10000) / 10000.0 },
        valueSetter: (params: { data: RadioLogEntryType, newValue: any }) => this.setCoordinate(params.data, 'lng', params.newValue)
      },
      { headerName: "Reported", headerTooltip: 'Report date', valueGetter: this.myDateGetter, maxWidth: 170, editable: false },
      // E-118 (2026-09-22): same overdue ramp as the map and the Rangers grid. cellClass
      // rather than cellStyle so the colour stays in the token layer (--rt-elapsed-N via
      // the global .rt-elapsed--N in styles/_patterns.scss) instead of becoming a third
      // hard-coded copy of the palette.
      {
        headerName: "Elapsed", headerTooltip: 'Hrs:Min:Sec since report', valueGetter: this.myMinuteGetter,
        maxWidth: 130, editable: false, cellClass: this.elapsedCellClass,
      },
      {
        headerName: "Status", field: "status", minWidth: 130, maxWidth: 220, cellRenderer: this.statusCellRenderer,
        cellStyle: (params: { value: string; }) => {
          // Sprint E: the fill now resolves through the token layer (semantic key ->
          // --rt-status-*, custom color passes through), and an explicit ink color is set
          // alongside it. Previously only background-color was set, so the label inherited
          // whatever text color was in scope - which is unreadable on roughly half the palette.
          const stat = this.radioLogStatuses.find(el => el.status == params.value)
          const stored = stat ? stat.color : '#A3A3A3'
          return { 'background-color': statusColorValue(stored), 'color': statusInkValue(stored) }
        }
        //cellClassRules: this.cellClassRules() }, //, maxWidth: 150
      },
      // F29-46 (2026-08-29): Source was gathered on every report since E-41 phase 1 but never
      // surfaced anywhere - a live gap this column closes. Non-editable: it's how the report
      // actually arrived, not a value a later correction should change.
      { headerName: "Source", field: "source", maxWidth: 110, editable: false },
      // F29-48 (2026-08-29, D-44): same "captured but never surfaced" shape as Source above -
      // whoever was filing the report when Submit was pressed. Blank on any report that
      // predates this field, or where the scribe left it blank - both legitimate, never
      // substitute the current session's operator for a missing one.
      { headerName: "Operator", field: "operator", maxWidth: 140, editable: false },
      // The ONLY flex column, on purpose - see autoSizeStrategy above. Notes is both the
      // most variable-length field and the one a scribe most wants extra room for, so it
      // takes whatever width the content-sized columns leave behind. minWidth raised from
      // 200 to 260 (raised live, 2026-08-27) - longer entries were getting squeezed toward
      // the old floor by the other columns' own content-driven widths.
      {
        headerName: "Notes", field: "notes", cellRenderer: this.notesCellRenderer, flex: 1, minWidth: 260,
        tooltipField: "notes"
      },
      // E-11 (2026-08-26): evidenceLocation was captured on Entry and visible nowhere
      // afterward - not the main map, not here. This is the other of the two places the
      // gap named; see mapLeaflet.component.ts's displayMarkers() for the main-map marker.
      {
        headerName: "Evidence", field: "evidenceLocation", maxWidth: 110, editable: false,
        cellRenderer: this.evidenceCellRenderer,
        tooltipValueGetter: (params: { data: RadioLogEntryType }) => {
          const loc = params.data.evidenceLocation
          return loc ? `Evidence/clue at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : undefined
        },
      },
    ]
  }

  /**
   * Sprint F phone carve-out: the grid is never constructed on a phone (not just
   * hidden), so this drives an @if in the template rather than CSS display:none.
   * Same breakpoint as styles/_breakpoints.scss's `phone` mixin (<=575px).
   */
  private phoneMediaQuery = window.matchMedia('(max-width: 575px)')
  public isPhone = signal(this.phoneMediaQuery.matches)
  private onPhoneMediaChange = (e: MediaQueryListEvent) => this.isPhone.set(e.matches)

  private gridApi: any
  private gridColumnApi
  private now: Date
  private http: any
  private numSeperatorWarnings = 0
  private maxSeperatorWarnings = 3

  // https://www.ag-grid.com/angular-data-grid/grid-interface/#grid-options-1
  // https://blog.ag-grid.com/how-to-get-the-data-of-selected-rows-in-ag-grid/
  // NOT monitored for changes on the fly: https://stackoverflow.com/questions/52519129/ag-grid-and-angular-how-to-switch-grid-options-dynamically/52519796#52519796
  gridOptions: GridOptions = {
    // PROPERTIES
    theme: rangertrakGridTheme,
    // v32.2+ object form. checkboxes/headerCheckbox off + enableClickSelection keeps the
    // original "multiple" behavior (click a row to select, ctrl/shift to extend) rather
    // than the new default, which would add a checkbox column the layout doesn't expect.
    rowSelection: {
      mode: 'multiRow',
      checkboxes: false,
      headerCheckbox: false,
      enableClickSelection: true,
    },

    // https://www.ag-grid.com/javascript-data-grid/row-pagination/#pagination-properties
    pagination: true,
    paginationAutoPageSize: true, // if set overrides paginationPageSize & forces it back to this on changes...
    //paginationPageSize: 5,
    // suppressScrollOnNewData: true, // grid to NOT scroll to the top, on page changes

    // EVENT handlers
    // onRowClicked: event => this.log.verbose('A row was clicked'),
    onSelectionChanged: (event: SelectionChangedEvent) => this.onRowSelection(event),
    // The grid's rows ARE the service's report objects, so an edit has already
    // mutated them by the time this fires - it just has to be written out.
    // Previously nothing did, and a "Save Reports" button alerted UNIMPLEMENTED,
    // so every correction a scribe typed into the grid was lost on reload.
    onCellValueChanged: () => this.onCellEdited(),

    // CALLBACKS
    // getRowHeight: (params) => 25

    // E-104 (2026-08-25): columns size to their CONTENT now, not to an even share of the
    // grid. `fitCellContents` measures each column's rendered cells and headers and sizes
    // to the widest - so `Lat` shrinks to the ~9 characters it holds and `Address` gets the
    // room it needs, instead of the reverse. Columns carrying `flex` are excluded from this
    // measurement by AG Grid, which is why exactly one column (Notes) keeps a flex value:
    // it absorbs whatever width is left over so the grid still fills its container with no
    // dead gutter on the right.
    autoSizeStrategy: { type: 'fitCellContents' },

    defaultColDef: {
      // `flex: 1` here is what previously made EVERY column flexible, which in turn made
      // `autoSizeStrategy` a no-op and left the per-column flex weights below fighting
      // sizeColumnsToFit(). Gone deliberately - flex is now opt-in, on Notes alone.
      minWidth: 60,
      editable: true,
      //singleClickEdit: true,
      resizable: true,
      sortable: true,
      filter: true,
      floatingFilter: true
    },
    // set rowData to null or undefined to show loading panel by default
    rowData: null,
  }
  private backupRowData: any[] = []
  private rowData: any[] = []

  constructor(
    private radioLogService: RadioLogService,
    private log: LogService,
    // private teamService: TeamService,
    // private rangerService: RangerService,
    private missionService: MissionService,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.log.info(` Construction`, this.id)
    ensureAgGridRegistered()

    this.now = new Date()
    this.gridApi = ""
    this.gridColumnApi = ""

    this.phoneMediaQuery.addEventListener('change', this.onPhoneMediaChange)
  }


  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  ngOnInit(): void {

    this.log.verbose("ngInit", this.id)

    // https://angular.io/tutorial/toh-pt4#call-it-in-ngoninit states subscribes should happen in OnInit()
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.columnDefs = this.buildColumnDefs()
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('Settings Subscription complete', this.id)
    })

    if (!this.settings) {
      this.log.error(`this.settings was null in ngOnInit`, this.id)
    }

    // Fallback build: the subscription above's `next` already ran synchronously in the
    // normal case (getMissionObserver() replays its current value), so this is a no-op
    // then - but if it ever doesn't, columnDefs must still exist before the grid renders
    // rather than staying unset until settings eventually arrives.
    if (!this.columnDefs) {
      this.columnDefs = this.buildColumnDefs()
    }

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (newReport) => {
        console.log(newReport)
        this.gotNewRadioLog(newReport)
      },
      error: (e) => this.log.error('Field Reports Subscription got:' + e, this.id),
      complete: () => this.log.info('Field Reports Subscription complete', this.id)
    })

    if (this.gridApi) {
      this.gridApi.refreshCells()
    } else {
      this.log.verbose("no this.gridApi yet in ngOnInit()", this.id)
    }
  }

  // -------------------------------------------------------------------------

  // REMOVED: imageCellRenderer_unused. It was wired to no column, and would not have
  // worked if it had been - it built `src=".../rangers/${callsign}"`, a path with no file
  // extension, so every image would have 404'd. Dead code that also lied about being
  // ready to use.
  //
  // Showing the reporter's photo on this grid is a reasonable idea (E-38 now has the
  // machinery: RangerPhotoService.photoUrl(callsign) plus the androgynous fallback), but
  // it adds a column to a grid that is already wide, so it is a product decision rather
  // than a revival of this.

  statusCellRenderer = (params: { data: RadioLogEntryType }) => {
    let title = `Status: ${params.data.status}`
    return `<span aria-hidden title="${title}"> ${params.data.status}</span>`
  }

  notesCellRenderer = (params: { data: RadioLogEntryType }) => {
    let title = `Note: ${params.data.notes}`
    return `<span aria-hidden title="${title}"> ${params.data.notes}</span>`
  }

  /** E-11: a compact flag icon when this report has an evidence/clue location, blank otherwise. */
  evidenceCellRenderer = (params: { data: RadioLogEntryType }) => {
    const loc = params.data.evidenceLocation
    if (!loc) return ''
    return `<span aria-hidden title="Evidence/clue at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}">🚩</span>`
  }

  /** E-114 open question 5: a compact marker for a row that arrived via a Report Packet
   *  merge, blank for a report typed directly on this device. See the Origin column's own
   *  comment in buildColumnDefs() for why this isn't the existing Source column. */
  originCellRenderer = (params: { data: RadioLogEntryType }) => {
    if (!params.data.sourceUid) return ''
    return `<span aria-hidden title="Merged in from a Report Packet - not typed on this device">📦</span>`
  }

  /**
   * Same fill/ink resolution the grid's Status column cellStyle uses (see columnDefs
   * above) - one source of truth for status color, reused by the phone card view.
   */
  statusFill(status: string): string {
    const stat = this.radioLogStatuses.find(el => el.status == status)
    return statusColorValue(stat ? stat.color : '#A3A3A3')
  }

  statusInk(status: string): string {
    const stat = this.radioLogStatuses.find(el => el.status == status)
    return statusInkValue(stat ? stat.color : '#A3A3A3')
  }

  //--------------------------------------------------------------------------

  //https://blog.ag-grid.com/conditional-formatting-for-cells-in-ag-grid/
  /* cellClassRules = (params: { data: RadioLogEntryType }) => {
    if (params.data.status == 'Urgent') {
      return "cell-pass" // see stylesheet for this
    }
    if (params.data.status == 'Check-in') {
      return "cell-pass" // see stylesheet for this
    }
    return(``)
  }
*/

  onGridReady = (params: any) => {
    this.log.verbose("onGridReady()", this.id)

    this.gridApi = params.api
    //this.log.verbose(`onGridReady() gridApi: ${this.gridApi}`, this.id)
    this.gridColumnApi = params.columnApi
    // this.log.verbose(`onGridReady() gridColumnApi: ${this.gridColumnApi}`, this.id)

    // E-104: `sizeColumnsToFit()` used to run here, and it is what actually produced the
    // reported defect - it distributes the grid's width across columns and IGNORES the
    // per-column `flex` weights, so `Address` (flex 30) rendered narrower than `Lat`
    // (flex 1). `autoSizeStrategy` in gridOptions does the sizing now, once, from content.

    // TODO: use this line, or onFirstDataRendered()?
    if (this.gridApi) {
      this.gridApi.refreshCells()
    } else {
      this.log.verbose("no this.gridApi yet in onGridReady()", this.id)
    }


    // set initial pagination size
    //paginationAutoPageSize: true
    // this.gridApi.paginationAutoPageSize(true) // also see: onRowsPerPage

    //this.log.verbose("onGridReady() done", this.id)
  }

  onFirstDataRendered(params: any) {
    this.log.verbose("onFirstDataRendered()", this.id)

    // following should not be needed, duplicate of onGridReady()...
    this.gridApi = params.api
    //this.log.verbose(`onGridReady() gridApi: ${this.gridApi}`, this.id)
    this.gridColumnApi = params.columnApi

    //params.api.sizeColumnsToFit();
    this.refreshGrid()
  }

  //--------------------------------------------------------------------------

  // https://www.ag-grid.com/javascript-data-grid/grid-events/#reference-selection-selectionChanged
  onRowSelection(event: SelectionChangedEvent) {
    let selectedNodes = this.gridApi.getSelectedNodes()
    this.selectedRows.set(selectedNodes.length)
    let selectedData = selectedNodes.map((node: { data: RadioLogEntryType; }) => node.data)
    this.log.verbose(`Selected Row Data obtained ${selectedNodes.length} selected rows`, this.id)
    this.radioLogService.setSelectedRadioLogEntries(selectedData)
  }

  //onFirstDataRendered(params: any) {
  refreshGrid() {
    // https://blog.ag-grid.com/refresh-grid-after-data-change/
    if (this.gridApi) {
      this.gridApi.refreshCells()
      // E-104: was sizeColumnsToFit(), which undid the content-based sizing on every
      // refresh (i.e. after every cell edit and every new report). autoSizeColumns() keeps
      // the same intent - columns matching their content - as data changes. Notes is
      // excluded because it is the flex column; AG Grid ignores flex columns here anyway.
      this.gridApi.autoSizeAllColumns()
    } else {
      this.log.warn(`refreshGrid(): gridApi not established yet!`, this.id)
    }
  }

  reloadPage() {
    this.log.verbose(`Reloading window!`, this.id)
    window.location.reload()
  }


  gotNewRadioLog(newReports: RadioLogType) {
    this.log.verbose(`New collection of ${newReports.numReport} Field Reports observed.`, this.id)

    this.radioLog = newReports
    this.radioLogEntries.set(newReports.logEntries)
    this.refreshGrid()
    //this.reloadPage()  // TODO: needed? - creates endless loop!
  }

  /**
   * Given a report, finds the date, and returns it as 'Sun Jan-01 23:00:00'
   * @param params
   * @returns
   */
  myDateGetter = (params: { data: RadioLogEntryType }) => {
    const weekday = ["Sun ", "Mon ", "Tue ", "Wed ", "Thu ", "Fri ", "Sat "]
    let dt = 'unknown date'
    let d: Date = params.data.date
    //this.log.excessive(`Day is: ${d.toISOString()}`, this.id)
    //this.log.excessive(`WeekDay is: ${d.getDay}`, this.id)

    try {  // TODO: Use the date pipe instead?
      //weekday[d.getDay()] +
      dt = formatDate(d, 'M-dd HH:MM:ss', 'en-US')
      //this.log.excessive(`Day is: ${params.data.date.toISOString()}`, this.id)
    } catch (error: any) {
      dt = `Bad date format: Error name: ${error.name}; msg: ${error.message}`
    }

    // https://www.w3schools.com/jsref/jsref_obj_date.asp
    //this.log.excessive(`Day is: ${params.data.date.toISOString()}`, this.id)
    /*
        if (this.isValidDate(d)) {
          dt = weekday[d.getDay()] + formatDate(d, 'yyyy-MM-dd HH:MM:ss', 'en-US')
          this.log.excessive(`Day is: ${params.data.date.toISOString()}`, this.id)
        }
    */
    return dt
  }

  /**
   * E-118: overdue band for a row, as an ag-grid cellClass. Returns no class at band 0 so a
   * log that is entirely current looks exactly as it did before this existed.
   */
  elapsedCellClass = (params: { data: RadioLogEntryType }) => {
    const band = overdueBand(
      elapsedMinutes(params.data.date),
      this.settings?.checkInIntervalMin ?? DEFAULT_CHECK_IN_INTERVAL_MIN)
    return band > 0 ? ['rt-elapsed', `rt-elapsed--${band}`] : []
  }

  myMinuteGetter = (params: { data: RadioLogEntryType }) => {
    let dt = new Date(params.data.date).getTime()
    let milliseconds = Date.now() - dt
    let seconds: string = (Math.round(milliseconds / 1000) % 60).toString().padStart(2, '0')
    let minutes: string = Math.floor((milliseconds / (1000 * 60)) % 60).toString().padStart(2, '0')
    let hours = Math.floor((milliseconds / (1000 * 60 * 60)) % 24)
    let days = Math.floor((((milliseconds / (1000 * 60 * 60 * 24)) + hours) / 24))
    return (`${days ? days + " days  " : ""} ${hours}:${minutes}:${seconds} `)
  }

  //! BUG: JUST ROUNDS THE lat, not whatever is passed in!!!!!
  // rounder = (params: { data: RadioLogEntryType }) => {
  //   let val = Math.round(params. data.lat * 10000) / 10000.0
  //   return val
  // }

  isValidDate(d: any) {
    return d instanceof Date //&& !isNaN(d);
  }

  // filteredReports:RadioLogEntryType[] = this.radioLogService.filterFieldReportsByDate(Date(-12*60*60*1000), Date(5*60*1000)) //FUTURE:
  // onBtnSetSelectedRowData() {
  //   let selectedNodes = this.gridApi.getSelectedNodes();
  //   let selectedData = selectedNodes.map((node: { data: RadioLogEntryType; }) => node.data);
  //   this.selectedRows = selectedNodes.length
  //   this.log.excessive(`onBtnGetSelectedRowData obtained ${ selectedNodes.length } selected rows: \n${ JSON.stringify(selectedData) } `, this.id)
  //   this.radioLogService.setSelectedRadioLogEntries(selectedData)
  // }


  /**
   * Material-M3 pass, 2026-08-26: reads the signal below rather than a native `<select>`.
   * `<mat-select>` renders no native `<select>`, so the previous
   * `getElementById('columnSeparator') as HTMLSelectElement` + `.selectedIndex`/`.options`
   * read would have thrown outright once the control was converted.
   */
  getParamValue(inputSelector: string) {
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

  private getParams() {
    let dt = new Date()
    return {
      columnSeparator: this.getParamValue('columnSeparator'),
      fileName: `FieldReportsExport.${dt.getFullYear()} -${dt.getMonth() + 1} -${dt.getDate()}_${dt.getHours()}:${dt.getMinutes()}.csv`,
    }
  }

  onSeperatorChange() {
    var params = this.getParams();
    if (params.columnSeparator && this.numSeperatorWarnings++ < this.maxSeperatorWarnings) {
      alert(`NOTE: Excel handles comma separators best.You've chosen "${params.columnSeparator}"`)
    }
  }

  onBtnExport() {
    // TODO: Does this handle new radio log entries properly?
    // https://www.ag-grid.com/javascript-data-grid/excel-export-styles/#styling-headers

    // const params = this.getParams();
    // this.gridApi.exportDataAsCsv(params);

    // ! Is this JUST for enterprise edition?! - test...
    // https://www.ag-grid.com/javascript-data-grid/excel-export-rows/#export-all-unprocessed-rows
    // Material-M3 pass, 2026-08-26: reads the signal below, not
    // `getElementById('allRows').checked`. `<mat-checkbox>` puts its real native input
    // several levels inside its own template, so that id now lands on the host element -
    // `.checked` there is `undefined`, which is falsy, so the old read would have SILENTLY
    // exported 'filteredAndSorted' every time regardless of the box. A wrong export with no
    // error is worse than a crash, which is why this moved to a signal rather than being
    // re-pointed at the nested input.
    this.gridApi.exportDataAsExcel({
      exportedRows: this.allRows() ? 'all' : 'filteredAndSorted',
    })
  }

  /**
   * E-114 Phase 1: builds a Report Packet of every field report currently on this device and
   * hands it off via the OS share sheet (Web Share API) where supported, falling back to a
   * plain download everywhere else - same fallback shape D-34 already established for the
   * File System Access API. `operator` is left blank: this page (unlike Entry) has no "who is
   * at the keyboard" concept of its own to draw one from, the same call `onBtnPrint309()`'s
   * own `preparedBy` already makes for the identical reason - inventing one would be worse
   * than leaving it for the receiving end to fill in from context.
   */
  async onBtnBuildReportPacket(): Promise<void> {
    // Packet assembly itself now lives in RadioLogService.buildReportPacketText() - see its
    // own doc comment for why (EntryComponent needs the identical payload for its own
    // field-mode "send my reports" button, and two copies of this were a divergence risk
    // not worth taking for the sake of avoiding one service method).
    const built = this.radioLogService.buildReportPacketText('')
    if (!built) {
      alert('There are no field reports on this device to package.')
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
        // AbortError = the operator cancelled the share sheet - not a failure, just fall
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

  /** Reads a picked Report Packet file and hands it to `mergeIncomingEntries()` (E-114 Phase
   *  0). No confirm() dialog needed - a merge only ADDS new entries and never touches an
   *  existing one, unlike every other import on this page's own Danger Zone. */
  async onReportPacketFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const packet = parseReportPacket(text)
      if (packet.schemaVersion > REPORT_PACKET_SCHEMA_VERSION) {
        alert(`"${file.name}" was built by a newer version of RangerTrak (schema v${packet.schemaVersion}). Update this device before importing it.`)
        return
      }

      const currentMission = this.settings?.mission?.trim()
      if (currentMission && packet.mission && packet.mission.trim() !== currentMission) {
        if (!confirm(
          `This Report Packet says "${packet.mission}", but this device's current mission `
          + `is "${currentMission}".\n\nImport its ${packet.entries.length} report`
          + `${packet.entries.length === 1 ? '' : 's'} anyway?`)) {
          this.log.verbose('onReportPacketFileSelected: user cancelled on mission mismatch.', this.id)
          return
        }
      }

      const { added, skipped, rejected } = this.radioLogService.mergeIncomingEntries(packet.entries, packet.operator)
      const lines = [`Merged ${added} new report${added === 1 ? '' : 's'} from "${file.name}".`]
      if (skipped) {
        lines.push(`${skipped} already present on this device were skipped.`)
      }
      if (rejected) {
        lines.push(`${rejected} report${rejected === 1 ? '' : 's'} could not be read (bad timestamp or location) and were NOT imported - see the Log page for which.`)
      }
      alert(lines.join('\n'))
    } catch (e: any) {
      this.log.error(`Could not read "${file.name}" as a Report Packet: ${e?.message ?? e}`, this.id)
      alert(`Could not read "${file.name}".\n\n${e?.message ?? e}`)
    }
  }

  /**
   * The generated ICS-309 log renderer, piece 2/4 of the E-31/E-41 export plan
   * (`buildIcs309Log()`, shared/export/ics309-log.ts - shipped 0.57.0, never wired to any UI
   * until now). One print-CSS layout serves both "print to PDF" and "print to a physical
   * printer" - a PDF is just what a browser's print dialog produces against a virtual PDF
   * printer, so this needs no second code path (unlike the 213, which fills a real PDF
   * template - the 309 has no usable fillable template to fill, per that module's own doc
   * comment).
   *
   * `preparedBy` is left blank, same principle `fillIcs213Pdf()`'s own doc comment already
   * states for its Reply block: this app has no "who is generating this specific log
   * printout" concept anywhere yet (`ics309-log.ts`'s own header comment says as much), and
   * inventing a value would be worse than leaving it blank for the recipient to hand-fill.
   */
  onBtnPrint309() {
    const reports = this.reportsForPrintScope()
    if (!reports.length) {
      alert(this.printScope() === 'sincePrint' && !this.settings?.lastPrintedAt
        ? 'No reports to print - nothing has been filed yet.'
        : 'No reports match that scope - nothing to print.')
      return
    }

    const log = buildIcs309Log(reports, {
      mission: this.settings.mission,
      opPeriod: this.settings.opPeriod,
      opPeriodStart: this.settings.opPeriodStart,
      opPeriodEnd: this.settings.opPeriodEnd,
    })
    this.ics309Log.set(log)
    this.log.info(`Printing ICS-309 log: ${reports.length} row(s), scope "${this.printScope()}".`, this.id)

    // A tick to let the print-only block (bound to the signal just set) actually render
    // before the browser's print dialog captures the page - `window.print()` right after a
    // signal write isn't guaranteed to see the updated DOM. Same reasoning as elsewhere in
    // this app that defers a native browser action by one tick after a state change.
    setTimeout(() => {
      window.print()
      // First print of THIS batch only marks the log, same "first print only" precedent
      // messages.component.ts's printAsIcs213() already established for printedAt - a
      // reprint of the same or an overlapping scope shouldn't keep pushing the "since last
      // print" boundary forward past reports this print run already covered.
      this.missionService.updateMission({ ...this.settings, lastPrintedAt: new Date() })
    }, 0)
  }

  /** The reports for whichever scope is currently picked - see printScopeOptions above. */
  private reportsForPrintScope(): RadioLogEntryType[] {
    const scope = this.printScope()

    if (scope === 'sincePrint') {
      const since = this.settings?.lastPrintedAt ? new Date(this.settings.lastPrintedAt).getTime() : 0
      return this.radioLogEntries().filter(r => new Date(r.date).getTime() > since)
    }

    // 'visible' and 'selected' both read through the grid, which doesn't exist on a phone
    // (Sprint F: "the grid is never constructed on a phone, not just hidden") - the print
    // row itself is gated behind `@if (!isPhone())` in the template for the same reason, so
    // reaching here on a phone would be a template bug, not a real case to design around.
    if (!this.gridApi) {
      this.log.warn(`reportsForPrintScope(): no gridApi for scope "${scope}"; printing every report instead.`, this.id)
      return this.radioLogEntries()
    }

    if (scope === 'selected') {
      return this.gridApi.getSelectedRows()
    }

    const rows: RadioLogEntryType[] = []
    this.gridApi.forEachNodeAfterFilterAndSort((node: { data: RadioLogEntryType }) => rows.push(node.data))
    return rows
  }

  /** 24-hour clock throughout this app (see report-time.ts) - not the locale-default DatePipe. */
  formatLogTime(date: Date | string): string {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  formatLogDateTime(date: Date | string): string {
    const d = new Date(date)
    return `${d.toLocaleDateString()} ${this.formatLogTime(d)}`
  }

  onBtnClearRadioLog() {
    if (Utility.getConfirmation('REALLY delete all FieldReports in LocalStorage?')) {
      this.log.info("Removing all field reports from local storage...", this.id)
      this.radioLogService.deleteAllRadioLogEntries()
      this.refreshGrid()
      this.reloadPage()
    }
  }

  /**
   * A cell was edited: persist to localStorage and republish, so the maps and
   * any other subscriber see the correction immediately. Replaces the old
   * "Save Reports" button, which the page itself described as something that
   * "should happen automatically".
   */
  private onCellEdited() {
    this.log.verbose(`Field report edited in grid; saving.`, this.id)
    this.radioLogService.saveEditedRadioLog()
  }

  /**
   * Writes an edited Lat/Lng back onto the report's nested location object.
   * Rejects anything non-numeric or out of range rather than storing NaN, which
   * would put the report - and the map bounds derived from it - nowhere.
   */
  private setCoordinate(report: RadioLogEntryType, axis: 'lat' | 'lng', newValue: any): boolean {
    const parsed = Number(newValue)
    const limit = axis === 'lat' ? 90 : 180

    if (newValue === '' || newValue === null || isNaN(parsed) || Math.abs(parsed) > limit) {
      this.log.warn(`Ignoring invalid ${axis} "${newValue}" for report ${report.id}.`, this.id)
      return false
    }

    report.location[axis] = parsed
    // An edited coordinate is no longer whatever the address geocoded to.
    report.location.derivedFromAddress = false
    return true
  }

  onBtnImportRadioLogFromJSON_unused() {
    alert(`onBtnImportFieldReports is unimplemented`)

    // TODO: look at: https://www.npmjs.com/package/fs-browsers

    // TODO: https://blog.ag-grid.com/refresh-grid-after-data-change/
    // https://stackblitz.com/edit/ag-grid-angular-hello-world-n3aceq?file=src%2Fapp%2Fapp.component.ts
    // https://www.ag-grid.com/javascript-data-grid/immutable-data/

    // https://github.com/ag-grid/ag-grid/issues/2450
    this.http
      .get("https://raw.githubusercontent.com/ag-grid/ag-grid/master/grid-packages/ag-grid-docs/src/olympicWinnersSmall.json")
      .subscribeOn((data: any[]) => {  // NOTE: subscribeOn() is a guess!!!
        data.length = 10;
        data = data.map((row, index) => {
          return { ...row, id: index + 1 };
        })
        this.backupRowData = data
        this.rowData = data
      })
  }

  /**
   *
   * @returns
   */
  /**
   * Material-M3 pass, 2026-08-26: takes the chosen value as an argument rather than reading
   * it back out of a native `<select>` via getElementById. The control is a `<mat-select>`
   * now, which renders no native `<select>` at all - the old
   * `getElementById(...) as HTMLSelectElement` read would have found the host element and
   * then thrown on `.options[...]`. Driving it from the emitted value is both correct here
   * and one less direct-DOM read of the kind Sprint G converted away from.
   */
  onRowsPerPage(option: string) {
    // this.gridApi.pagination = true // should have been done initially...
    switch (option) {
      case "Auto":
        this.log.verbose("onRowsPerPage set to Auto", this.id)
        //this.gridApi.paginationSetPageSize()
        this.gridApi.paginationAutoPageSize = true
        this.gridApi.redrawRows()
        break;
      case "5":
        //! WORKS! - Maybe any number LESS than auto????
        this.log.verbose("onRowsPerPage set to 5", this.id)
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("5")
        break;
      case "10":
        // WORKS! - Maybe any number LESS than auto????
        this.log.verbose("onRowsPerPage set to 10", this.id)
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("10")
        break;
      case "25":
        this.log.verbose("onRowsPerPage set to 25", this.id)
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("25")
        break;
      case "50":
        this.log.verbose("onRowsPerPage set to 50", this.id)
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("50")
        break;
      case "100":
        this.log.verbose("onRowsPerPage set to 100", this.id)
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("100")
        break;
      case "All":
        this.log.verbose("onRowsPerPage set to All", this.id)
        //https://www.ag-grid.com/javascript-data-grid/infinite-scrolling
        //set rowModelType: infinite ???
        this.gridApi.pagination = false
        this.gridApi.paginationAutoPageSize = false
        break;

      default:
        this.log.error(`onRowsPerPage got unknown option: ${option}`, this.id)
        break;
    }
    // this.refreshGrid()
  }

  ngOnDestroy() {
    this.radioLogSubscription?.unsubscribe()
    this.missionSubscription?.unsubscribe()
    this.phoneMediaQuery.removeEventListener('change', this.onPhoneMediaChange)
  }
}
