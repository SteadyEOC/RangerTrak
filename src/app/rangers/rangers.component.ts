import { ColDef, ColumnResizedEvent, GridOptions, GridSizeChangedEvent } from 'ag-grid-community'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../domain/overdue'
import { isAiGeneratedPhoto, withAiBadge } from '../shared/ai-photo'
import { bundledRangerImage } from '../shared/ranger-image'
//import { TooltipModule } from 'ng2-tooltip-directive'
import { Subscription } from 'rxjs'

import { CommonModule, DOCUMENT } from '@angular/common'
import { AfterViewInit, ApplicationRef, Component, Inject, OnDestroy, OnInit, ViewChild, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { RouterLink } from '@angular/router'
import { AgGridAngular } from 'ag-grid-angular';
import { GuideService } from '../shared/guide/guide.service';
import { PageComponent } from '../shared/page/page.component';
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatSelectModule } from '@angular/material/select'
import { FilterChipsComponent } from '../shared/filter-chips/filter-chips.component';
import { describeGridFilters, FilterChip } from '../domain/grid-filter-chips';
import { zipSync, Zippable } from 'fflate';
import { photoEntryName } from '../domain/ranger-photo-export';

import { Utility } from '../shared'
import { ensureAgGridRegistered } from '../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../shared/ag-grid-theme'
import { AlertsComponent } from '../shared/alerts/alerts.component'
import { ExpandableSectionComponent } from '../shared/expandable-section/expandable-section.component'
import { IoPanelComponent } from '../shared/io-panel/io-panel.component'
import { LayersCardComponent } from '../shared/io-panel/layers-card.component'
import { LayerService } from '../shared/services/layer.service'
import { layersOfKind, recordableLayerName } from '../domain/layers'
import type { ViewContext } from '../domain/view'
import { ViewService } from '../shared/services/view.service'
import { AdvancedDirective } from '../shared/view/advanced.directive'
import { readSheetFile, rowsToXlsxBytes } from '../shared/import/sheet-reader'
import { formatReportTime } from '../shared/mapping/report-time'
import {
  RadioLogService, RadioLogEntryType, LogService, RangerService, RangerType,
  MissionService, MissionType
} from '../shared/services'
// Direct path, not the barrel: importing a service used as a DI token through
// shared/services/index.ts leaves it unresolvable to the compiler ("no suitable injection
// token"), the same way the barrel broke `imports:` arrays during Sprint B.
import { RangerPhotoService } from '../shared/services/ranger-photo.service'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { ImportSafetyService } from '../shared/services/import-safety.service'
import { ImportSafetyCardComponent } from '../shared/import-safety/import-safety-card.component'
// E-122 Phase 2a: reloadPage() below awaits this before reloading - see its own doc comment.
import { RecordStore } from '../shared/storage/record-store'
import { DevicePrefsService } from '../shared/services/device-prefs.service'
import { LOCKED_FILE_MESSAGE, readEnvelope } from '../shared/export/handover-kind'
import { entryCountOf, extractMissionZip, layerName, MissionZipManifest, MissionZipPhoto } from '../shared/export/mission-zip'
import { describeRangerMerge, normalizeRangerIds } from '../domain/ranger-migration'
import { idColumnLabel, rosterToRows, rowsToCsv } from '../domain/roster-sheet'
import { buildRosterPrint, RosterPrintGroup } from '../domain/roster-print'
import { PrintSheetHeadComponent } from '../shared/print-sheet/print-sheet-head.component'
import { armPrintTitle } from '../shared/export/print-title'
import { showFirstPrintTip } from '../shared/export/print-tip'
import type { RosterImportDialogResult } from './roster-import-dialog/roster-import-dialog.component'
import { CustomTooltip } from './customTooltip'
import { localDateStamp } from '../shared/export/local-date'
import { escapeHtml } from '../shared/escape-html'
import { capGridToScreens, GRID_MAX_SCREENS } from '../shared/grid-width-cap'


@Component({
  selector: 'rangertrak-rangers',
  standalone: true,
  imports: [CommonModule, AgGridAngular, PageComponent, ExpandableSectionComponent, IoPanelComponent, LayersCardComponent, PrintSheetHeadComponent, RouterLink, FilterChipsComponent, MatFormFieldModule, MatIconModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatSelectModule, AdvancedDirective, ImportSafetyCardComponent],
  templateUrl: './rangers.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./rangers.component.scss']
})
export class RangersComponent implements OnInit, AfterViewInit, OnDestroy {

  private id = 'Ranger Component'
  private readonly layerService = inject(LayerService)
  readonly view = inject(ViewService)

  /** E-207: the advanced controls on this page that Simple view can hide. */
  protected readonly advancedIds = ['layers-panel', 'setup-file'] as const

  /** E-207 / D-62 item 3: how many lists of people are loaded here, for ViewService. */
  rangersHere(): Partial<ViewContext> {
    return { layerCount: layersOfKind(this.layerService.layers(), 'people').length }
  }
  private readonly appRef = inject(ApplicationRef)
  private readonly journal = inject(MissionJournalService)
  private readonly importSafety = inject(ImportSafetyService)
  title = 'Rangers & Teams'
  pageDescr = `Grid display of rangers & teams on this mission`

  private rangersSubscription!: Subscription
  // Mutated inside the rangersSubscription's subscribe() callback, not an Angular
  // template binding - this app is zoneless, so a plain field written there has no
  // guaranteed path back into change detection. Signals close that gap (Sprint G).
  public rangers = signal<RangerType[]>([])

  // 2026-09-30, John: E-144 - the grid was a fixed 60vh, so a 12-ranger roster on a tall monitor
  // sat above ~150px of empty grid before the pager. domLayout 'autoHeight' would fix that but
  // switches paginationAutoPageSize off and renders every row, which a hundreds-of-rows roster
  // must not do. So the grid stays a normal fixed-height grid (scrolls/pages as before) and only
  // the height is computed: enough for the rows, capped at the old 60vh. rowHeight and
  // headerHeight are pinned in gridOptions so this arithmetic is exact, not a guess at the
  // theme's defaults. One spare row of slack keeps auto-page-size from rounding down to a
  // page that is a row short of the roster.
  private static readonly GRID_ROW_PX = 42
  private static readonly GRID_HEADER_PX = 48
  /** Header + floating filter + pager, plus a pixel or two of border. */
  private static readonly GRID_CHROME_PX = 48 * 3 + 2

  // E-205: on a phone the grid is compact - tighter rows and header, three columns (see
  // buildColumnDefs) - so noticeably more people fit on screen. Same breakpoint as
  // styles/_breakpoints.scss's `phone` mixin (<=575px), as the Radio Log uses. Desktop is untouched.
  private static readonly PHONE_ROW_PX = 34
  private static readonly PHONE_HEADER_PX = 36
  private phoneMediaQuery = window.matchMedia('(max-width: 575px)')
  public isPhone = signal(this.phoneMediaQuery.matches)
  private onPhoneMediaChange = (e: MediaQueryListEvent) => {
    this.isPhone.set(e.matches)
    this.columnDefs = this.buildColumnDefs(this.idFieldLabel)
    this.gridApi?.setGridOption?.('rowHeight', this.rowPx())
    this.gridApi?.setGridOption?.('headerHeight', this.headerPx())
    this.gridApi?.setGridOption?.('floatingFiltersHeight', this.headerPx())
    this.gridApi?.resetRowHeights?.()
    setTimeout(() => this.fitColumns())
  }
  private idFieldLabel = 'ID'
  private rowPx = () => this.isPhone() ? RangersComponent.PHONE_ROW_PX : RangersComponent.GRID_ROW_PX
  private headerPx = () => this.isPhone() ? RangersComponent.PHONE_HEADER_PX : RangersComponent.GRID_HEADER_PX

  readonly gridHeight = computed(() => {
    const rows = Math.max(this.rangers().length, 3) + 1
    const chrome = this.isPhone() ? this.headerPx() * 3 + 2 : RangersComponent.GRID_CHROME_PX
    const px = rows * this.rowPx() + chrome
    // A phone has little else on the page worth keeping in view, so the grid may take more of it.
    return `min(${this.isPhone() ? 75 : 60}vh, ${px}px)`
  })

  private radioLogSubscription!: Subscription
  // "Not checked in" column: the most recent radio log entry date per ranger, keyed
  // `rangerUid || callsign` - same join key drawTrails()/displayMarkers() use (ADR D-42
  // phase 5). Read by lastContactCellRenderer/lastContactValueGetter below, not a signal -
  // ag-grid's cellRenderer/valueGetter are plain functions re-invoked on refreshCells(),
  // so this only needs to be current when the grid actually redraws, not push its own
  // change detection. Deliberately recomputed only when radio log entries change (grid refresh
  // triggered below), not on a setInterval - same "computed once when this method runs, not
  // a live-updating clock" choice mapLeaflet.component.ts's drawTrails() elapsed-time
  // readout already made, for the same reason: it goes stale until the next redraw rather
  // than ticking on its own.
  private lastContactByKey = new Map<string, Date>()

  /** Spreadsheet (.xlsx) or CSV. */
  public exportFormat = signal<'xlsx' | 'csv'>('xlsx')
  /** How many grid rows are selected (the Export card's subtitle). */
  public selectedCount = signal(0)
  /** Export everyone, ignoring the selection and any filters. */
  public allRows = signal(false)
  /** E-187 phase D: the contact sheet being printed; null except while the print dialog is open. */
  public rosterSheet = signal<{ groups: RosterPrintGroup[], count: number, printedAt: Date } | null>(null)
  /** "N photos for M rangers" for the rows an export would take. */
  public exportPhotoCount = signal(0)
  public exportRangerCount = signal(0)
  /** E-190: one chip per column filter that is on, and how many rows get through them. */
  public filterChips = signal<FilterChip[]>([])
  public shownCount = signal(0)

  private missionSubscription!: Subscription
  private settings!: MissionType

  alert: any

  // The confidentiality bar above the roster. Dismissal is remembered per browser, which
  // is the point - it used to be a permanent block that pushed the grid down the page on
  // every visit, and a warning that cannot be acknowledged is a warning people learn to
  // read past. Dismissing it hides the *bar*; the full notice stays in the "Privacy &
  // data handling" section below and cannot be removed.
  //
  // Deliberately its own localStorage key (held by DevicePrefsService) rather than a field on the settings object:
  // this is a per-device UI acknowledgement, not mission data, and it must not ride along
  // in Mission Export or trigger the settings migration 24e is tracking.
  privacyNoticeDismissed = false


  now: Date

  // https://www.ag-grid.com/angular-data-grid/grid-interface/#grid-options-1
  private gridApi: any
  private gridColumnApi: any

  protected fitToScreen = signal(inject(DevicePrefsService).getGridFit('rangers'))
  private lastGridWidth = 0

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
    // E-144: pinned so gridHeight() can size the grid to its rows exactly.
    rowHeight: this.rowPx(),
    headerHeight: this.headerPx(),
    floatingFiltersHeight: this.headerPx(),

    // EVENT handlers
    // onSelectionChanged: (event: SelectionChangedEvent) => this.onRowSelection(event),
    // 2026-09-28, John: same pattern radio-log.component.ts's gridOptions already uses
    // (onCellValueChanged -> onCellEdited() -> <service>.saveEdited...()) - see
    // onCellEdited()'s own comment for why the roster gets the same treatment now.
    onCellValueChanged: () => this.onCellEdited(),
    onSelectionChanged: () => { this.selectedCount.set(this.gridApi?.getSelectedRows?.().length ?? 0); this.refreshExportPhotoCount() },
    onFilterChanged: () => this.refreshFilterChips(),
    // 2026-10-18: rows arriving (an import, a restore) change what the grid shows without any filter
    // changing, which left "Prints 0 of 9" on the Print card. Recount whenever the row model updates.
    onModelUpdated: () => this.refreshFilterChips(),
    // 2026-10-27, John: same width cap as the Radio Log - after every auto-size and on a resize the
    // widest columns are trimmed so the grid is at most 1.5 screens wide (1 with Fit to screen).
    // A phone's flex columns already fit, so the cap leaves them alone.
    onColumnResized: (e: ColumnResizedEvent) => {
      if (e.finished && e.source === 'autosizeColumns') this.capGridWidth()
    },
    // A width change re-sizes from content (which caps again); see the Radio Log's same handler.
    onGridSizeChanged: (e: GridSizeChangedEvent) => {
      if (e.clientWidth === this.lastGridWidth) return
      this.lastGridWidth = e.clientWidth
      if (this.isPhone()) e.api.sizeColumnsToFit()
      else e.api.autoSizeAllColumns()
    },

    // CALLBACKS
    // getRowHeight: (params) => 25
    //},

    // E-104 (2026-08-25): same content-based sizing as the Radio Log entries grid - see
    // field-reports.component.ts for the full reasoning. On this grid the symptom was
    // `ID` and `Notes` holding "(none set)" and "-" in ~290px columns while `Call Sign`
    // and `Full Name` were squeezed.
    // E-205: a phone's three columns share the grid's width instead (see buildColumnDefs).
    autoSizeStrategy: this.isPhone() ? { type: 'fitGridWidth' } : { type: 'fitCellContents' },

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
    const img = `<img class="licenseImg" style="height:40px; width:40px;" alt="Photo of ${escapeHtml(params.data.fullName || params.data.callsign)}"
      src="${src}">`
    // The demo roster's AI-generated faces carry a small "AI" badge (shared/ai-photo.ts).
    return withAiBadge(img, isAiGeneratedPhoto(params.data.image, !!this.photos.photoUrl(params.data)))
  }

  /** Shared by the renderers above - see the resolution order there. */
  photoSrc(ranger: RangerType): string {
    const local = this.photos.photoUrl(ranger)
    if (local) return local
    if (ranger.image) return `${this.settings.imageDirectory}rangers/${bundledRangerImage(ranger.image)}`
    return `${this.settings.imageDirectory}rangers/androgynous.svg`
  }

  // D-42 phase 7: a blank callsign is no longer a defect - plenty of CERT/MERT responders
  // are not ham-licensed, and a resolvable `id` (or the internal `uid`) carries the join
  // now, not callsign. The "⚠ (none set)" treatment this cell used to own moves to
  // idCellRenderer below, since a blank `id` ("hasn't checked in yet") is the state that
  // actually leaves a report unattributable.
  callsignCellRenderer = (params: { data: RangerType }) => {
    if (this.sharedWithOthers('callsign', params.data)) {
      return `<span aria-hidden title="Another ranger has the same call sign. Reports logged with it go to the first match, so the rows can't be told apart." `
        + `style="color:#c0392b;font-weight:700"> ⚠ ${escapeHtml(params.data.callsign)}</span>`
    }
    const title = escapeHtml(`${params.data.fullName} | ${params.data.phone}`)
    return `<span aria-hidden title="${title}"> ${escapeHtml(params.data.callsign)}</span>`
  }

  idCellRenderer = (params: { data: RangerType }) => {
    // Same #c0392b as the map's UNASSIGNED_MARKER (ranger-icon.ts) so the two read as one
    // signal, not two different warnings, wherever an operator sees either.
    if (!params.data.id?.trim()) {
      return `<span aria-hidden title="No id set - not checked in yet, or no credential on file. Radio log entries from this ranger can't be attributed by id until one is." style="color:#c0392b;font-weight:700"> ⚠ (none set)</span>`
    }
    // E-263 (tester, 2026-10-28): a shared ID is allowed - capability, not policy (D-46) - but marked,
    // the same way import's rosterWarnings() already reports it, so a typo is caught.
    if (this.sharedWithOthers('id', params.data)) {
      return `<span aria-hidden title="Another ranger has the same ID. Reports matched by ID go to the first match." `
        + `style="color:#c0392b;font-weight:700"> ⚠ ${escapeHtml(params.data.id)}</span>`
    }
    return `<span aria-hidden> ${escapeHtml(params.data.id)}</span>`
  }

  /** True when another roster row has the same non-blank value (case and spaces ignored). */
  private sharedWithOthers(field: 'id' | 'callsign', ranger: RangerType): boolean {
    const key = (ranger[field] ?? '').trim().toUpperCase()
    return !!key && this.rangerService.rangers.some(r => r !== ranger && r.uid !== ranger.uid && (r[field] ?? '').trim().toUpperCase() === key)
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
   * ranger with no radio log entry on file yet ("not checked in"). */
  lastContactValueGetter = (params: { data: RangerType }) => {
    return this.lastContactFor(params.data)?.getTime() ?? null
  }

  // Same #c0392b "not attributable yet" red idCellRenderer uses below, for the same reason:
  // this is the other half of "can this ranger's activity be tracked at all right now."
  lastContactCellRenderer = (params: { data: RangerType }) => {
    const last = this.lastContactFor(params.data)
    if (!last) {
      return `<span aria-hidden title="No radio log entry received yet from this ranger." `
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
    this.idFieldLabel = idFieldLabel
    const all = this.allColumnDefs(idFieldLabel)
    if (!this.isPhone()) return all
    // E-205: name, call sign and team only; the rest is one tap away on a wider screen.
    const keep = ['fullName', 'callsign', 'team']
    // All three flex (autoSizeStrategy skips flex columns), so together they fit the screen exactly
    // instead of keeping desktop widths and scrolling sideways.
    return keep.map(f => all.find(c => c.field === f)!).map(c =>
      ({ ...c, flex: c.field === 'fullName' ? 2 : 1, width: undefined, minWidth: 70, maxWidth: undefined }))
  }

  private allColumnDefs(idFieldLabel: string): ColDef[] {
    return [
      // F29-12 (2026-08-29): Image first, then the mission's identity field, then callsign -
      // matches the order a scribe actually scans a roster row in.
      // Fixed: the cell renders a 40x40 <img>, so measuring its content is pointless -
      // it is always exactly one thumbnail wide.
      // 2026-09-28, John: explicitly non-editable - it only ever had a cellRenderer (the
      // thumbnail), no cellEditor, so double-clicking it used to open AG Grid's default
      // plain-text editor (the raw filename) floating over the thumbnail. That made this
      // the grid's first EDITABLE column by definition order, which is not where a scribe
      // filling in a brand-new blank ranger should land - see focusNewRangerRow() below.
      // E-166 (2026-09-30): header tooltips, ARES feedback - what each column holds and how it is filled in.
      { headerName: "Image", headerTooltip: 'The ranger\'s photo. Hover a photo to see it larger. It cannot be edited here.', field: "image", cellRenderer: this.imageCellRenderer, tooltipField: "image", tooltipComponentParams: { color: '#ececec' }, width: 80, maxWidth: 80, resizable: false, editable: false },
      // 2026-09-30, John: E-151 - the bare default "ID" reads "Ranger ID", same as Entry's label.
      { headerName: (idFieldLabel || '').trim() === '' || idFieldLabel.trim() === 'ID' ? 'Ranger ID' : idFieldLabel, field: "id", cellRenderer: this.idCellRenderer, singleClickEdit: true, maxWidth: 170,
        headerTooltip: 'The ranger\'s ID number, issued at check-in (for example REW-0038 or TEW-1003). Blank means not checked in yet. Click to edit.' },
      { headerName: "Call Sign", headerTooltip: 'FCC call sign, such as K7ABC. It can be blank for members who are not licensed. Double-click to edit.', field: "callsign", cellRenderer: this.callsignCellRenderer, minWidth: 110, maxWidth: 200 },
      { headerName: "Full Name", headerTooltip: 'The ranger\'s full name. Double-click to edit.', field: "fullName", tooltipField: "FCC Licensee Name", minWidth: 150, maxWidth: 300 },
      { headerName: "Phone", field: "phone", singleClickEdit: true, maxWidth: 170,
        headerTooltip: 'Phone number, in any format you like (for example 206-555-0123). It is not checked. Click to edit.' },
      // 2026-10-18, John: the team field was stored, imported, exported and printed by, but had no column.
      { headerName: "Team", field: "team", minWidth: 110, maxWidth: 200,
        headerTooltip: 'The ranger\'s team. Use one unique name per team; with mutual aid, include the town or department, such as Burien CERT 2. Double-click to edit.' },
      { headerName: "Role", field: "role", maxWidth: 200,
        headerTooltip: 'The ranger\'s job or position, such as Team Leader or Medic. Free text. Double-click to edit.' },
      {
        headerName: "Last Contact", colId: "lastContact",
        headerTooltip: 'Time of this ranger\'s most recent radio log entry, in 24-hour time with how many minutes ago. A red phone mark means no entry yet. It cannot be edited.',
        valueGetter: this.lastContactValueGetter, cellRenderer: this.lastContactCellRenderer,
        editable: false, minWidth: 150, maxWidth: 220,
      },
      // The only flex column - takes whatever the content-sized columns leave over.
      { headerName: "Notes", field: "note", flex: 1, minWidth: 150,
        headerTooltip: 'Anything else worth knowing about this ranger. Free text, and it can be blank. Double-click to edit.' },
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
    private _snackBar: MatSnackBar,
    // The confidentiality bar's "What this means" opens the Guide drawer's Privacy tab -
    // see openPrivacyDetails().
    private guide: GuideService,
    private recordStore: RecordStore,
    private devicePrefs: DevicePrefsService,
    private dialog: MatDialog,
    @Inject(DOCUMENT) private document: Document
  ) {
    ensureAgGridRegistered()

    this.now = new Date()
    this.gridApi = ""
    this.gridColumnApi = ""
  }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  ngOnInit(): void {

    this.privacyNoticeDismissed = this.devicePrefs.isRangersPrivacyNoticeDismissed()
    this.phoneMediaQuery.addEventListener('change', this.onPhoneMediaChange)
    this.columnDefs = this.buildColumnDefs(this.idFieldLabel)

    this.alert = new AlertsComponent(this._snackBar, this.log, this.missionService, this.document) // TODO: Use Alert Service to avoid passing along doc & snackbar as parameters!
    //this.teamService = teamService
    //this.rangerService = rangerService

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.columnDefs = this.buildColumnDefs(newMission.idFieldLabel)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id)
    })

    this.rangersSubscription = this.rangerService.getRangersObserver().subscribe({
      next: (newRangers) => {
        this.rangers.set(newRangers)
      },
      error: (e) => this.log.error('Rangers Subscription got:' + e, this.id)
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (reports) => {
        this.lastContactByKey = RangersComponent.buildLastContactByKey(reports.logEntries)
        this.refreshGrid()
      },
      error: (e) => this.log.error('Radio Log entries Subscription got:' + e, this.id)
    })


    if (this.rangers().length < 1) {
      this.alert.Banner("No Rangers have been entered yet. Go to the bottom & click on 'Advanced' to resolve.")
      //this.alert.OpenSnackBar(`No Rangers found. Please enter them into the grid and then use the Update button,  or provide a Rangers.JSON file to import from or FUTUREE: Import them from an Excel file.`, `Nota Bene`, 1000)
    } else {
      //this.alert.OpenSnackBar(`Imported "${this.rangers().length}" rangers.`, `Nota Bene`, 1000)
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
    this.refreshFilterChips()
    this.photos.whenReady().then(() => this.refreshExportPhotoCount())

    // E-104: sizeColumnsToFit() removed - it distributes grid width evenly and ignores
    // per-column flex, which is what squeezed Call Sign while ID sat half empty.
    // autoSizeStrategy in gridOptions handles sizing from content instead.
    // TODO: use this line, or next routine?!
    if (this.gridApi) {
      this.gridApi.refreshCells()
    }
  }

  onFirstDataRendered(params: any) {
    // E-104: autoSizeStrategy already sized these from content by the time this fires.
    if (this.gridApi) {
      this.gridApi.refreshCells()
    }
  }

  //--------------------------------------------------------------------------

  /**
   * 2026-09-28, John: "clicked Add Ranger and got a new row on the LAST page with a fake
   * photo and fake info, while the grid stayed on page 1." Two separate bugs:
   *
   *   1. The fake-looking data: RangerService.AddRanger()'s no-args branch used to hand
   *      back a hardcoded demo row ("!A_New_Tactical" / "AAA_New_Name" / a stock male.png
   *      photo / a fake phone number) - fixed at the source, see that method's own comment.
   *   2. "Stayed on page 1": this used to call reloadPage() (a full window.location.reload())
   *      after adding ONE row - unnecessary (this.rangers() already reflects the new roster
   *      through the same RangerService subscription every other mutation goes through) and
   *      actively counterproductive: a full reload always remounts the grid back to page 1,
   *      which is the "stayed on page 1" symptom. Reload is gone; focusNewRangerRow() below
   *      does the real fix - find wherever the new row actually landed (AddRanger() sorts by
   *      callsign, so "last row" was never reliable either) and go there.
   */
  onBtnAddRanger(formData?: string) {
    this.log.info("Added a new ranger.", this.id)
    const added = this.rangerService.AddRanger(formData ?? "")  // this calls updateLocalStorageAndPublish
    // Keeps the grid's own copy in lockstep with the service synchronously, rather than
    // waiting for the next change-detection pass to pick up the `rangers()` signal through
    // the [rowData] binding - focusNewRangerRow() right below needs the new row to already
    // be in the grid's row model.
    this.gridApi?.setGridOption('rowData', this.rangers())
    this.refreshGrid()
    this.focusNewRangerRow(added)
  }

  /**
   * Moves the grid to whatever page the new row landed on, scrolls it into view, selects it,
   * and opens its first editable cell for typing - see onBtnAddRanger()'s own comment. Uses
   * the row's position in the CURRENT filtered/sorted view (forEachNodeAfterFilterAndSort),
   * not its position in the underlying array, since that view is what pagination actually
   * pages through.
   */
  private focusNewRangerRow(added: RangerType): void {
    if (!this.gridApi) return

    let rowIndex = -1
    this.gridApi.forEachNodeAfterFilterAndSort((node: { data: RangerType }, index: number) => {
      if (node.data === added) rowIndex = index
    })
    if (rowIndex < 0) {
      this.log.warn(`Could not find the new ranger in the grid, so the grid did not scroll to it.`, this.id)
      return
    }

    const pageSize = this.gridApi.paginationGetPageSize()
    if (pageSize > 0) {
      this.gridApi.paginationGoToPage(Math.floor(rowIndex / pageSize))
    }
    this.gridApi.ensureIndexVisible(rowIndex, 'middle')

    const rowNode = this.gridApi.getDisplayedRowAtIndex(rowIndex)
    rowNode?.setSelected(true, true)

    const firstEditableField = this.columnDefs.find(c => c.editable !== false && c.field)?.field
    if (firstEditableField) {
      this.gridApi.setFocusedCell(rowIndex, firstEditableField)
      this.gridApi.startEditingCell({ rowIndex, colKey: firstEditableField })
    }
  }

  /**
   * The Radio Log grid has always saved on every committed cell edit; the Rangers grid used
   * to require a separate "Save edits" button instead. Investigated 2026-09-28 (John):
   * RangerService.updateLocalStorageAndPublish() - the button's only action - does no
   * validation of any kind (rosterWarnings()'s duplicate-callsign/duplicate-id checks are an
   * IMPORT-time advisory only, never called from here), so there was nothing left for a
   * manual Save step to actually gate. The button and its "unsaved" framing are gone; the
   * route was never wired to unsavedChangesGuard (only /mission is, per app.routes.ts), so
   * there was no guard state to remove alongside it.
   *
   * One real, pre-existing side effect carried over unchanged: updateLocalStorageAndPublish()
   * re-sorts the roster by callsign on every save, same as the old button already did - so a
   * row can still move once its callsign commits. Not new behavior, just now automatic.
   */
  private onCellEdited() {
    this.log.info(`Edited a ranger in the grid.`, this.id)
    this.rangerService.updateLocalStorageAndPublish()
    // E-263: an edit can make (or end) a duplicate on another row, so redraw both columns' marks.
    this.gridApi?.refreshCells?.({ columns: ['id', 'callsign'], force: true })
  }

  /**
   * E-262 (tester, 2026-10-28): "+ Add" pressed once too often left a row nobody could remove
   * short of Delete all. Deletes the selected rows. ADR D-43: by surrogate uid, not callsign -
   * a blank or duplicated callsign could otherwise delete the wrong row.
   */
  onBtnDeleteSelected() {
    const selected: RangerType[] = this.gridApi?.getSelectedRows?.() ?? []
    if (!selected.length) return
    const label = (r: RangerType) => r.callsign?.trim() || r.fullName?.trim() || r.id?.trim() || '(blank row)'
    const names = selected.slice(0, 5).map(label).join(', ') + (selected.length > 5 ? ` and ${selected.length - 5} more` : '')
    const what = selected.length === 1 ? 'this ranger' : `these ${selected.length} rangers`
    if (!Utility.getConfirmation(
      `Delete ${what} from this browser?\n\n${names}\n\n`
      + `Radio log entries already filed are not deleted. They keep the call sign they were logged with, `
      + `but no longer link to a roster row.`)) return
    selected.forEach(r => { if (r.uid) this.rangerService.deleteRangerByUid(r.uid) })
    this.log.info(`Deleted ${selected.length} ranger(s).`, this.id)
    this.journal.record('rangers-deleted', `Deleted ${selected.length} ranger${selected.length === 1 ? '' : 's'} from the roster.`)
    this.layerService.prune('people', new Set(this.rangerService.rangers.flatMap(r => r.uid ? [r.uid] : [])))
    this.gridApi?.setGridOption('rowData', this.rangers())
    this.selectedCount.set(0)
    this.refreshGrid()
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
      + `Radio log entries already filed are not deleted, but they will refer to callsigns `
      + `that are no longer in the roster.\n\n`
      + `Export the roster first if you might want it back.`)) {
      this.journal.record('roster-cleared', `Deleted all ${count} rangers from this device.`)
      this.rangerService.deleteAllRangers()
      this.layerService.prune('people', new Set())
      this.refreshGrid()
      this.reloadPage()
    }
  }

  //--------------------------------------------------------------------------
  onDeselectAll() {
    this.log.verbose(`onDeselectAll: Deleteing all rangers`, this.id)
    this.gridApi.deselectAll()
  }

  // onBtnUpdateLocalStorage removed 2026-09-28: was the "Save edits" button's only action -
  // see onCellEdited()'s own comment for why edits now save automatically instead.

  //--------------------------------------------------------------------------
  // Import a list (E-187 Layers, ADR D-58)
  //
  // One entry point, "Import a list...", for everything: a spreadsheet (CSV / Excel), a Setup
  // file (.zip) or - quietly - an old RangerTrak .json. Every path shows the same preview
  // (added / updated / unchanged / skipped) and defaults to ADDING; Replace is the explicit
  // "start over" choice, behind its own confirm (in the dialog). A blank cell never erases.

  /** Opens the shared preview dialog; resolves to what the user chose, or undefined on cancel. */
  private async openImportDialog(
    fileName: string,
    extra: {
      incoming?: RangerType[]; sheet?: Awaited<ReturnType<typeof readSheetFile>>; notes?: string[]
      trackable?: boolean; layerName?: string; layerAsOf?: string; layerSource?: string
    },
  ): Promise<RosterImportDialogResult | undefined> {
    const { RosterImportDialogComponent } = await import('./roster-import-dialog/roster-import-dialog.component')
    const ref = this.dialog.open(RosterImportDialogComponent, {
      width: '56rem',
      maxWidth: '95vw',
      data: {
        fileName,
        idFieldLabel: this.settings?.idFieldLabel ?? 'ID',
        existing: this.rangerService.rangers,
        ...extra,
      },
    })
    return await new Promise(resolve => ref.afterClosed().subscribe(result => resolve(result)))
  }

  /**
   * Saves what the dialog chose, records the import baseline, and says what happened. First keeps the E-198
   * safety copy, so "Undo last import" can put the roster back; returns null (nothing saved) when the person
   * cancels because the copy could not be kept.
   */
  private async applyImport(fileName: string, result: RosterImportDialogResult, layer = ''): Promise<string | null> {
    if (await this.importSafety.ensureBeforeImport('roster', fileName) === 'cancelled') return null
    if (result.action === 'replace') {
      this.rangerService.replaceAllRangers(result.incoming)
      this.rangerService.recordImport(fileName, 'replace')
    } else {
      this.rangerService.replaceAllRangers(result.merge.rangers)
      this.rangerService.recordMergeImport(fileName, result.merge)
    }
    const layerNote = this.trackLayer(fileName, result)
    const summary = result.action === 'replace'
      ? `Replaced the roster with ${result.incoming.length} people from "${fileName}".`
      : `Imported "${fileName}"${layer ? ` (from "${layer}")` : ''}: ${describeRangerMerge(result.merge)}.${layerNote}`
    this.journal.record('roster-imported', summary)
    this.gridApi?.setGridOption('rowData', this.rangers())
    this.refreshGrid()
    await this.importSafety.markImportDone()
    return summary
  }

  /**
   * E-187 phase C: removes the people the user agreed to remove (they left the layer), remembers
   * which people this layer holds, and forgets uids that are no longer on the device. Returns a
   * sentence for the summary, or '' when the import was not tracked as a layer.
   */
  private trackLayer(fileName: string, result: RosterImportDialogResult): string {
    let note = ''
    if (result.removeUids.length) {
      const gone = new Set(result.removeUids)
      this.rangerService.replaceAllRangers(this.rangerService.rangers.filter(r => !r.uid || !gone.has(r.uid)))
      note += ` Removed ${gone.size} no longer in "${result.layer?.name}".`
    }
    if (result.layer) {
      const uids = result.action === 'replace'
        ? this.rangerService.rangers.map(r => r.uid)
        : [...result.merge.added, ...result.merge.overwritten, ...result.merge.unchanged].map(n => n.uid)
      this.layerService.record({
        name: result.layer.name, kind: 'people', asOf: result.layer.asOf, source: result.layer.source,
        fileName, importedAt: new Date().toISOString(), uids: uids.filter((u): u is string => !!u),
      })
    }
    this.layerService.prune('people', new Set(this.rangerService.rangers.map(r => r.uid).filter((u): u is string => !!u)))
    return note
  }

  /**
   * A Setup file (.zip, E-109 v2: `mission-zip.json` plus an optional `photos/`) - the same shape
   * the Setup file card on the Mission page builds. Applies ONLY the rangers and their photos, matching this page's scope
   * ("roster and nothing else"): settings or locations the file also carries are not applied
   * here (the preview says so). Its rangers go through the same preview as any other list.
   */
  private async importRosterFromZip(file: File) {
    let manifest: MissionZipManifest
    let photos: MissionZipPhoto[]
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (readEnvelope(bytes)) throw new Error(LOCKED_FILE_MESSAGE)
      ;({ manifest, photos } = extractMissionZip(bytes))
    } catch (error: any) {
      this.log.error(`Could not read ${file.name} as a Setup file: ${error.message}`, this.id)
      alert(`Could not read "${file.name}".\n\n${error.message}`)
      return
    }

    if (!manifest.rangers) {
      alert(`"${file.name}" does not carry a Rangers category - there is nothing here for `
        + `Import a list to apply. If it carries places or settings instead, use the `
        + `Setup file card on the Mission page to load those.`)
      return
    }

    const otherCategories = [manifest.settings && 'mission settings', manifest.locations && 'places']
      .filter((c): c is string => !!c)
    const named = layerName(manifest)
    const notes = [
      ...(named ? [`From "${named}".`] : []),
      ...(otherCategories.length
        ? [`This file also carries ${otherCategories.join(' and ')}. Import a list does not apply those; use the Setup file card on the Mission page for the whole file.`]
        : []),
      ...(entryCountOf(manifest)
        ? [`This file also holds ${entryCountOf(manifest)} radio log entr${entryCountOf(manifest) === 1 ? 'y' : 'ies'}; merge them from Radio Log → Hand over to another scribe.`]
        : []),
      ...(photos.length ? [`${photos.length} photo${photos.length === 1 ? '' : 's'} will be stored on this device.`] : []),
    ]

    const result = await this.openImportDialog(file.name, {
      incoming: normalizeRangerIds(manifest.rangers).rangers, notes,
      // A hand-over is not a layer (D-59); any other named file is remembered as one.
      trackable: manifest.layer?.kind !== 'handover',
      layerName: recordableLayerName(manifest.layer),
      layerAsOf: manifest.layer?.asOf, layerSource: manifest.layer?.source,
    })
    if (!result) {
      this.log.verbose('importRosterFromZip: user cancelled.', this.id)
      return
    }

    const summary = await this.applyImport(file.name, result, named)
    if (summary === null) return
    // E-207 / D-62 item 6: a Setup file may suggest a view (a device in Simple view has no Setup file
    // card to load it from). Applied once, and never over the person's own choice.
    this.view.suggest(manifest.suggestedView)
    const rosterNow = this.rangerService.rangers
    const files = photos.map(p =>
      new File([p.bytes as BlobPart], p.filename, { type: this.mimeFor(p.filename) }))
    const { stored, unmatched } = await this.photos.importFiles(files, rosterNow)
    if (stored.length) this.journal.record('photos-imported', `Stored ${stored.length} ranger photos from the Setup file.`)

    const lines = [summary, `${stored.length} photo${stored.length === 1 ? '' : 's'} stored.`]
    if (unmatched.length) {
      lines.push('', `${unmatched.length} photo${unmatched.length === 1 ? '' : 's'} did not match a callsign and were skipped.`)
    }
    if (stored.length) {
      lines.push('', 'Reloading so every screen picks them up...')
      alert(lines.join('\n'))
      this.reloadPage()
    } else {
      this._snackBar.open(summary, 'OK', { duration: 20000 })
    }
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
    if (stored.length) this.journal.record('photos-imported', `Stored ${stored.length} ranger photos on this device (${unmatched.length} unmatched).`)

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
    const count = this.photos.count()
    await this.photos.clear()
    this.journal.record('photos-cleared', `Deleted all ${count} ranger photos from this device.`)
    this.reloadPage()
  }

  /**
   * Handles a file picked via "Import a list...": a spreadsheet (CSV / Excel) goes through the
   * column-mapping dialog, a Setup file (.zip) and a RangerTrak .json go straight to the
   * preview. Nothing is saved until the user chooses Add to roster or Replace.
   */
  async onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event

    if (!file) {
      return
    }

    try {
      if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
        await this.importRosterFromZip(file)
        return
      }

      if (/\.json$/i.test(file.name) || file.type === 'application/json') {
        // Old RangerTrak files keep loading, quietly. Same preview as everything else, and
        // it adds: a .json no longer replaces the roster behind the user's back (D-58).
        const text = await file.text()
        if (readEnvelope(new TextEncoder().encode(text))) throw new Error(LOCKED_FILE_MESSAGE)
        const incoming = this.rangerService.parseRosterJson(text)
        const result = await this.openImportDialog(file.name, { incoming })
        if (result) {
          const summary = await this.applyImport(file.name, result)
          if (summary !== null) this._snackBar.open(summary, 'OK', { duration: 20000 })
        }
        return
      }

      const sheet = await readSheetFile(file)
      const result = await this.openImportDialog(file.name, { sheet })
      if (result) {
        const summary = await this.applyImport(file.name, result)
        if (summary !== null) this._snackBar.open(summary, 'OK', { duration: 20000 })
      }
    } catch (error: any) {
      this.log.error(`onImportFileSelected: ${file.name} rejected: ${error.message}`, this.id)
      alert(`Could not import "${file.name}".\n\n${error.message}`)
    }
  }

  //--------------------------------------------------------------------------
  // E-190: active-filter chips

  /** Re-reads the grid's filters into chips and recounts the rows that get through them. */
  private refreshFilterChips(): void {
    if (!this.gridApi?.getFilterModel) return
    const headerFor = (colId: string): string =>
      this.gridApi.getColumn(colId)?.getColDef().headerName ?? colId
    this.filterChips.set(describeGridFilters(this.gridApi.getFilterModel(), headerFor))
    let shown = 0
    this.gridApi.forEachNodeAfterFilter?.(() => shown++)
    this.shownCount.set(shown)
    this.refreshExportPhotoCount()
  }

  /** Recounts the photos the export would take; the rows follow the same rule as the roster export. */
  refreshExportPhotoCount(): void {
    const rows = this.rowsToExport()
    this.exportRangerCount.set(rows.length)
    this.exportPhotoCount.set(this.photos.countFor(rows))
  }

  onAllRowsChange(checked: boolean): void {
    this.allRows.set(checked)
    this.refreshExportPhotoCount()
  }

  async onClearFilter(colId: string): Promise<void> {
    await this.gridApi?.setColumnFilterModel(colId, null)
    await this.gridApi?.onFilterChanged()
  }

  onClearAllFilters(): void {
    this.gridApi?.setFilterModel(null)
  }

  //--------------------------------------------------------------------------
  // Export

  /** The rows an export covers: everyone when asked (the changes-export fallback), else the selection if there
   *  is one, else what the grid is showing (filtered and sorted). */
  private rowsToExport(everyone = false, ignoreAllRows = false): RangerType[] {
    const all = this.rangerService.rangers
    if (everyone || (this.allRows() && !ignoreAllRows) || !this.gridApi?.getSelectedRows) {
      return all
    }
    const selected: RangerType[] = this.gridApi.getSelectedRows()
    if (selected.length) {
      return selected
    }
    const shown: RangerType[] = []
    this.gridApi.forEachNodeAfterFilterAndSort?.((node: { data: RangerType }) => shown.push(node.data))
    return shown
  }

  /**
   * Downloads the roster as a spreadsheet (.xlsx) or CSV. The columns are the ones "Import a
   * list" recognises on its own, so the file comes back in with no mapping changes.
   */
  async onBtnExportRoster(everyone = false) {
    const rows = this.rowsToExport(everyone)
    if (!rows.length) {
      alert('There are no rangers to export.')
      return
    }

    // Confirm before the roster leaves the app: the exported file carries names, personal
    // phone numbers and call signs in the clear, and nothing this app does can protect it
    // afterwards.
    if (!Utility.getConfirmation(
      `Export ${rows.length} ranger${rows.length === 1 ? '' : 's'} to a file?\n\n`
      + `The exported file contains PERSONAL INFORMATION - legal names, `
      + `personal phone numbers and call signs - and is NOT encrypted.\n\n`
      + `Store it somewhere appropriate, share it only with people who need it for this `
      + `mission, and delete it when the mission is over.`)) {
      this.log.verbose('onBtnExportRoster: user cancelled export.', this.id)
      return
    }

    const table = rosterToRows(rows, this.settings?.idFieldLabel)
    const stamp = localDateStamp()
    const partial = rows.length < this.rangerService.rangers.length ? '-selected' : ''
    if (this.exportFormat() === 'xlsx') {
      const bytes = await rowsToXlsxBytes(table)
      this.downloadBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `rangertrak-roster-${stamp}${partial}.xlsx`)
    } else {
      this.downloadBlob(new Blob(['\uFEFF', rowsToCsv(table)], { type: 'text/csv;charset=utf-8' }),
        `rangertrak-roster-${stamp}${partial}.csv`)
    }
    this.journal.record('roster-exported', `Exported ${rows.length} rangers as ${this.exportFormat()}.`)
  }

  //--------------------------------------------------------------------------
  // Print (E-187 Layers phase D, ADR D-58)

  /** The mission's name for the ID column ("Ranger ID" when it has none), for the contact sheet's heading. */
  public idLabel(): string {
    return idColumnLabel(this.settings?.idFieldLabel)
  }

  /** How many rows the Print card will print (its subtitle): the selection if there is one, else what the grid shows. */
  public printCount(): number {
    return this.selectedCount() > 0 ? this.selectedCount() : this.shownCount()
  }

  /**
   * Prints a contact sheet of the rows the grid is showing or has selected, grouped by team.
   * The sheet is a print-only block in this page (hidden on screen, see styles.scss); this
   * renders it, puts the body class on for the duration of the print, and takes it away again,
   * as Radio Log's ICS-309 does. The sheet holds names and phone numbers, so it is a paper
   * copy of the roster: the card says so.
   */
  onBtnPrintRoster(): void {
    const rows = this.rowsToExport(false, true)
    if (!rows.length) {
      alert('There are no rangers to print.')
      return
    }
    this.rosterSheet.set({ groups: buildRosterPrint(rows), count: rows.length, printedAt: new Date() })
    this.appRef.tick() // the sheet must be in the page before the browser lays it out
    showFirstPrintTip()
    document.body.classList.add('rt-print-roster')
    const untitle = armPrintTitle('Roster', this.settings)
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      document.body.classList.remove('rt-print-roster')
      this.rosterSheet.set(null)
      untitle()
    }
    window.addEventListener('afterprint', finish, { once: true })
    this.journal.record('print-roster', `Printed a contact sheet of ${rows.length} rangers.`)
    const started = Date.now()
    window.print()
    // print() blocks until the dialog closes on desktop browsers. Where it returns at once, wait
    // for afterprint - and, as a last resort, the next tap or click - rather than pulling the
    // sheet out from under the preview.
    if (Date.now() - started > 500) {
      finish()
    } else {
      setTimeout(() => document.addEventListener('pointerdown', finish, { once: true }), 1000)
    }
  }

  /**
   * Downloads the stored photos of the rows the roster export would take, as a .zip of
   * <ID or CALLSIGN>.<ext> files that "Import photos" reads straight back in. Images are
   * already compressed, so the zip stores them as they are.
   */
  async onBtnExportPhotos() {
    const rows = this.rowsToExport()
    const { photos, unreadable } = await this.photos.photosFor(rows)
    if (!photos.length) {
      alert(unreadable
        ? `None of the ${unreadable} photo${unreadable === 1 ? '' : 's'} for these rangers could be read, so nothing was exported.`
        : 'There are no photos stored on this device for these rangers, so there is nothing to export.')
      return
    }

    if (!Utility.getConfirmation(
      `Export ${photos.length} photo${photos.length === 1 ? '' : 's'} to a file?\n\n`
      + `The exported file contains photographs of volunteers' faces - personal information - `
      + `and is NOT encrypted.\n\n`
      + `Store it somewhere appropriate, share it only with people who need it for this `
      + `mission, and delete it when the mission is over.`)) {
      this.log.verbose('onBtnExportPhotos: user cancelled export.', this.id)
      return
    }

    const files: Zippable = {}
    for (const { stem, blob } of photos) {
      files[photoEntryName(stem, blob.type)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
    }
    const stamp = localDateStamp()
    const partial = rows.length < this.rangerService.rangers.length ? '-selected' : ''
    this.downloadBlob(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }),
      `rangertrak-roster-${stamp}${partial}-photos.zip`)
    this.journal.record('photos-exported', `Exported ${photos.length} ranger photos.`)
    if (unreadable) {
      alert(`${unreadable} photo${unreadable === 1 ? ' was' : 's were'} unreadable and left out.`)
    }
  }

  /**
   * "Export changes" (2026-10-05, John): downloads just the rangers added or edited on this
   * device since the roster was imported, plus the uids of any removed, for the coordinator to
   * merge back into the master list after the event. A CSV with a leading `change` column
   * (added / edited / removed) since E-187; it imports like any list, and the rules are in
   * domain/roster-changes.ts.
   */
  onBtnExportRosterChanges() {
    const changes = this.rangerService.changesSinceImport()
    if (!changes) {
      if (confirm('No roster import is recorded on this device, so there is nothing to compare '
        + 'against.\n\nExport the whole roster instead?')) {
        this.onBtnExportRoster(true)
      }
      return
    }

    const since = new Date(changes.importedAt).toLocaleString()
    const total = changes.added.length + changes.edited.length + changes.removed.length
    if (!total) {
      alert(`No changes since the roster was imported from "${changes.source}" (${since}).`)
      return
    }

    const names = (list: RangerType[]) => list.slice(0, 6).map(r => r.callsign || r.id || r.fullName).join(', ')
      + (list.length > 6 ? ', ...' : '')
    const lines = [
      `Changes since the roster was imported from "${changes.source}" (${since}):`,
      '',
      `  ${changes.added.length} added${changes.added.length ? ': ' + names(changes.added) : ''}`,
      `  ${changes.edited.length} edited${changes.edited.length ? ': ' + names(changes.edited) : ''}`,
      `  ${changes.removed.length} removed`,
      '',
      'Download these as a file for the coordinator? It holds names and phone numbers: '
        + 'hand it over the way you would the roster itself.',
    ]
    if (!confirm(lines.join('\n'))) {
      return
    }

    const table = rosterToRows([], this.settings?.idFieldLabel, { changes })
    this.downloadBlob(new Blob(['\uFEFF', rowsToCsv(table)], { type: 'text/csv;charset=utf-8' }),
      `rangertrak-roster-changes-${localDateStamp()}.csv`)
    this.journal.record('roster-changes-exported', `Exported roster changes: ${changes.added.length} added, ${changes.edited.length} edited, `
      + `${changes.removed.length} removed.`)
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = this.document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
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

  /**
   * E-122 Phase 2a: awaits `recordStore.flush()` first. Every caller here follows a roster
   * mutation (import, delete all, restore, ...) - those used to be safe to reload straight
   * after with localStorage's synchronous writes, but the roster now persists to IndexedDB on
   * RecordStore's own async queue, so a reload could otherwise race an in-flight write and
   * silently revert it. Same fix, same reasoning, as BackupService.importMission()'s own doc
   * comment. `async` costs callers nothing - none of them awaited this already, and a
   * fire-and-forget call still runs the reload once the flush resolves.
   */
  async reloadPage() {
    this.log.verbose(`Reloading window!`, this.id)
    await this.recordStore.flush()
    window.location.reload()
  }

  refreshGrid() {
    if (this.gridApi) {
      this.gridApi.refreshCells()
      this.fitColumns()
    }
  }

  private capGridWidth() {
    capGridToScreens(this.gridApi, this.fitToScreen() ? 1 : GRID_MAX_SCREENS)
  }

  /** Fit to screen (John 2026-10-27), remembered on this device. Re-sizes from content, then caps. */
  toggleFitToScreen() {
    this.fitToScreen.update(fit => !fit)
    this.devicePrefs.setGridFit('rangers', this.fitToScreen())
    this.fitColumns()
  }

  /** Desktop sizes columns from content (E-104: sizeColumnsToFit() undid that after every edit);
   *  a phone's three columns share the grid's width, so nothing scrolls sideways (E-205). */
  private fitColumns() {
    if (this.isPhone()) this.gridApi?.sizeColumnsToFit()
    else this.gridApi?.autoSizeAllColumns()
  }

  //--------------------------------------------------------------------------
  // Confidentiality bar

  dismissPrivacyNotice() {
    this.privacyNoticeDismissed = true
    if (!this.devicePrefs.dismissRangersPrivacyNotice()) {
      // Private-browsing or a full quota. The bar still goes away for this visit; it
      // simply comes back next time, which is the safe direction to fail in.
      this.log.warn('Could not save that the privacy notice was dismissed.', this.id)
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
    this.phoneMediaQuery.removeEventListener('change', this.onPhoneMediaChange)
    this.rangersSubscription?.unsubscribe()
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
  }
}
