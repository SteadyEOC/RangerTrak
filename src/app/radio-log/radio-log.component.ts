import { MasonryDirective } from '../shared/layout/masonry.directive'
import { RouterLink } from '@angular/router'
import { GridOptions, SelectionChangedEvent } from 'ag-grid-community'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../domain/overdue'
// , TeamService
import { Observable, subscribeOn, Subscription } from 'rxjs'

import { CommonModule, DOCUMENT, formatDate } from '@angular/common'
import { AfterViewInit, Component, inject, Inject, OnDestroy, OnInit, Pipe, PipeTransform, ElementRef, ChangeDetectionStrategy, signal, computed } from '@angular/core';

import { AgGridAngular } from 'ag-grid-angular';
import { PageComponent } from '../shared/page/page.component';
import { ExpandableSectionComponent } from '../shared/expandable-section/expandable-section.component';
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatSelectModule } from '@angular/material/select'
import { FilterChipsComponent } from '../shared/filter-chips/filter-chips.component';
import { describeGridFilters, FilterChip } from '../domain/grid-filter-chips';

// 2026-09-02: also imported from its own file now, not the '../shared/' barrel - same
// reason as rangerColorFor below (the barrel re-exports ranger-icon.ts's Leaflet-typed
// functions too, and 'leaflet' has side effects esbuild can't tree-shake out of a barrel).
import { ensureAgGridRegistered } from '../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../shared/ag-grid-theme'
// Imported from its own file, not the '../shared/' barrel - that barrel also re-exports the
// MapLibre style helpers, and this route is already its own lazy chunk (loadComponent in
// app.routes.ts); going through the barrel would drag MapLibre into THIS chunk for no reason.
import { rangerColorFor } from '../shared/mapping/ranger-marker'
import { buildIcs309Log, Ics309Log } from '../shared/export/ics309-log'
import { formatStation } from '../domain/station-label'
import { applyCallsignEdit, callsignEditNotice } from '../domain/ranger-match'
import { isScenarioEntry, formatScenarioTime, scenarioTimeAt, sameScenarioClock } from '../domain/scenario'
import { UsageStateService } from '../shared/services/usage-state.service'
import { AarNoteService } from '../shared/services/aar-note.service'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { clearedPlain, noteMatcher } from '../domain/clear-choices'
import { AttachmentStoreService } from '../shared/services/attachment-store.service'
import { ImportSafetyService } from '../shared/services/import-safety.service'
import { AttachmentChipComponent } from '../shared/attachments/attachment-chip.component'
import { attachmentChipHtml, attachmentChipUid } from '../shared/attachments/attachment-chip-html'
import { escapeHtml } from '../shared/escape-html'
import { AttachmentViewerService } from '../shared/attachments/attachment-viewer.service'
import { parseReportPacket, REPORT_PACKET_SCHEMA_VERSION } from '../shared/export/report-packet'
import { diagnoseFile, REPORT_PACKET_DAMAGED_MESSAGE } from '../shared/export/import-file'
import { MISSION_EXPORT_SCHEMA_VERSION } from '../shared/services/backup.service'
import { sendReportPacket } from '../shared/export/report-packet-send'
import { mediaSummary, PHOTOS_LEFT_OUT_MESSAGE } from '../domain/report-packet-files'
import {
  RadioLogService, RadioLogStatusType, RadioLogType, RadioLogEntryType, LogService,
  RangerService, MissionService, MissionType, statusColorValue, statusInkValue,
  MissionLocationService, FieldModeService, RangerPhotoService
} from '../shared/services'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import * as packageJson from '../../../package.json'
import { describeRangerMerge } from '../domain/ranger-migration'
import { describeLocationMerge } from '../domain/location-merge'
import { buildHandoverFile } from '../shared/export/handover-file'
import { liveRefs, nameWithKind } from '../domain/attachments'
import type { AttachmentFile } from '../shared/export/attachments-zip'
import type { HandoverDialogResult } from './handover-dialog/handover-dialog.component'
// E-122 Phase 2a: reloadPage() below awaits this before reloading - see its own doc comment.
import { RecordStore } from '../shared/storage/record-store'
import {
  formatMsgNoFull, formatMsgNoShort, HANDLED_MARK_GLYPH, HANDLED_MARK_LABEL, msgNoClashSentence, msgNoCsvFields, MSG_NO_CSV_COLUMNS,
} from '../domain/msg-no'
import { DevicePrefsService } from '../shared/services/device-prefs.service'
import { showFirstPrintTip } from '../shared/export/print-tip'
import { armPrintTitle } from '../shared/export/print-title'

@Pipe({ name: 'myUnusedPipe' })
export class myUnusedPipe implements PipeTransform {
  transform(val: string) {
    return val.toUpperCase()
  }
}


// 2026-08-31: renamed from field-reports.component.ts / FieldReportsComponent - this file
// (and radio-log.service.ts/radio-log-entry.interface.ts alongside it) used to keep the
// original "Radio Log entry" name deliberately, on the theory that renaming everywhere would be
// "pure churn" once only the page's own display label changed (0.75.0's ICS-309/213
// restructuring, Reports -> Radio Log). Revisited and reversed: the class/file/service names
// had become the exact stale-second-name problem the rest of that restructuring existed to
// fix.
/** E-196 (D-66): hover text for the scenario mark (Origin column and phone cards). */
const SCENARIO_MARK_TITLE = 'Scenario traffic from the exercise controller, not typed by a player'

@Component({
  selector: 'rangertrak-radio-log',
  standalone: true,
  imports: [
    CommonModule,
    MasonryDirective,
    AgGridAngular,
    PageComponent,
    RouterLink,
    ExpandableSectionComponent,
    FilterChipsComponent,
    AttachmentChipComponent,
    MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatSelectModule
  ],
  templateUrl: './radio-log.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./radio-log.component.scss']
})
export class RadioLogComponent implements OnInit, OnDestroy {

  private id = 'Radio Log'
  title = 'Radio Log — ICS-309'
  pageDescr = `Every radio log entry, in one grid - who, where, when, and what they said. Add new entries on the Entry page; edit existing ones here.`

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
  /** Export every row, ignoring the selection and any filters. */
  public allRows = signal(false)
  /** E-190: one chip per column filter that is on, and how many rows get through them. */
  public filterChips = signal<FilterChip[]>([])
  public shownCount = signal(0)

  // Material-M3 pass, 2026-08-26: the export controls' state, replacing three
  // getElementById reads (see getParamValue/onBtnExport below for why each had to go -
  // one would have thrown, one would have silently exported the wrong rows).
  /** CSV column separator: 'none' (comma), 'tab', or a literal character. */
  public columnSeparator = signal('none')
  /** Rows per page, as shown in the picker: 'Auto' | '5' | ... | 'All'. */
  public rowsPerPage = signal('Auto')

  /** Options for the rows-per-page picker - kept here so the template just iterates. */
  // E-144 follow-up: the grid was a fixed 60vh, leaving an empty band under a short log. Same
  // approach as the Rangers grid: keep it a normal paginated grid and compute only the height -
  // enough for the rows on one page, capped at the old 60vh, so a long log still paginates
  // (Auto) or pages at the picked size (5..100) instead of growing unbounded. "All" turns
  // pagination off and scrolls inside the 60vh cap. rowHeight/headerHeight are pinned in
  // gridOptions so the arithmetic is exact; one spare row keeps auto-page-size from rounding
  // down to a page a row short.
  private static readonly GRID_ROW_PX = 42
  private static readonly GRID_HEADER_PX = 48
  /** Header + floating filter + pager, plus a pixel or two of border. */
  private static readonly GRID_CHROME_PX = 48 * 3 + 2
  readonly gridHeight = computed(() => {
    const total = this.radioLogEntries().length
    const perPage = Number(this.rowsPerPage())
    const visible = Number.isFinite(perPage) && perPage > 0 ? Math.min(total, perPage) : total
    const px = (Math.max(visible, 3) + 1) * RadioLogComponent.GRID_ROW_PX + RadioLogComponent.GRID_CHROME_PX
    return `min(60vh, ${px}px)`
  })
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
  //
  // 2026-09-28, John (item 8a): "one click to the print dialog" for the COMMON case - this
  // already was one click regardless of scope (no preview step between the button and
  // window.print(), see onBtnPrint309() below), but the default scope was 'visible' -
  // whatever the grid's current filter/sort happened to show, which is session-dependent and
  // not actually "the common case." Defaulting to 'sincePrint' instead makes the common case
  // exactly what the task describes: reportsForPrintScope() reads `lastPrintedAt` as epoch 0
  // when nothing has ever been printed, so 'sincePrint' on a first print already means
  // "everything" - the same default covers both "since the last print" and "all," with no
  // separate "all" option needed. 'visible'/'selected' stay in the picker as secondary,
  // manually-chosen scopes.
  public printScope = signal<'visible' | 'selected' | 'sincePrint'>('sincePrint')
  readonly printScopeOptions: { value: 'visible' | 'selected' | 'sincePrint'; label: string }[] = [
    { value: 'sincePrint', label: 'Since the last print (or all, if never printed)' },
    { value: 'visible', label: 'Filtered & sorted rows shown now' },
    { value: 'selected', label: 'Selected rows' },
  ]
  // 2026-09-25 (maintainer): "does it print on a form that looks like the official ICS-309?
  // The option should be there." 'form' mirrors the standard ICS 309 as ARES/AUXCOMM groups
  // publish it (FEMA's current forms list has no 309 - see ics309-log.ts) - numbered boxes
  // 1-7, FROM/TO call sign and Msg # columns. 'list' is the original compact printout. The
  // form is the default: it is what a receiving EOC or net manager expects to be handed.
  public printLayout = signal<'form' | 'list'>('form')
  readonly printLayoutOptions: { value: 'form' | 'list'; label: string }[] = [
    { value: 'form', label: 'ICS-309 form' },
    { value: 'list', label: 'Simple list' },
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
      // E-218 (Q35): the status mark, first. A click cycles blank, then handled, passed on, needs action,
      // and back to blank. Filterable by its glyph; the cell is a button for the keyboard and a screen reader.
      {
        colId: 'handledMark', headerName: HANDLED_MARK_GLYPH.handled, maxWidth: 70, editable: false, floatingFilter: false,
        headerTooltip: 'Status mark. Click a box to cycle: handled (check), passed on (arrow), needs action (!), then blank. Prints in the first column of the ICS-309 log.',
        valueGetter: (params: { data: RadioLogEntryType }) => params.data?.handled ? HANDLED_MARK_GLYPH[params.data.handled.mark] : '',
        cellRenderer: this.handledCellRenderer,
        onCellClicked: (params: { data: RadioLogEntryType, node: any, api: any }) => this.onHandledClicked(params),
        tooltipValueGetter: (params: { data: RadioLogEntryType }) =>
          params.data?.handled ? HANDLED_MARK_LABEL[params.data.handled.mark] : 'No mark. Click to mark handled.',
      },
      // E-220 / D-68: the message number (short form) replaces the visible line number; `id` stays
      // internal (row identity, selection). The full form is the tooltip. Typing "A007" in the filter finds it.
      {
        colId: 'msgNo', headerName: 'Msg #', maxWidth: 110, editable: false,
        headerTooltip: 'The message number: station letter and sequence, such as A007. Set when the entry is logged and never changed. Hover a number for the mission and operational period. It cannot be edited.',
        valueGetter: (params: { data: RadioLogEntryType }) => formatMsgNoShort(params.data?.msgNo),
        tooltipValueGetter: (params: { data: RadioLogEntryType }) => formatMsgNoFull(params.data?.msgNo) || undefined,
        comparator: (_a: unknown, _b: unknown, nodeA: { data: RadioLogEntryType }, nodeB: { data: RadioLogEntryType }) =>
          (nodeA.data.msgNo?.seq ?? 0) - (nodeB.data.msgNo?.seq ?? 0),
      },
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
        headerTooltip: 'Shows a mark if this entry was merged in from another device\'s Report Packet (a clapperboard if it is scenario traffic from the exercise controller). Blank if it was typed on this device. It cannot be edited.',
        cellRenderer: this.originCellRenderer,
        tooltipValueGetter: (params: { data: RadioLogEntryType }) =>
          params.data.sourceUid ? (isScenarioEntry(params.data) ? SCENARIO_MARK_TITLE : 'Merged in from another device - not typed on this device') : undefined,
      },
      // E-165 (2026-09-30): the tactical call the From station used, immediately before the FCC
      // Callsign column. Read-only for this pass - an edit here would need the operator's
      // call sign and roster link re-resolved (and the record-at-save-time rule says an entry
      // never re-resolves on its own), so a correction is made by re-entering the entry. The
      // tooltip names the operator through the LIVE roster (rangerUid -> fullName): the useful
      // hover for an unlicensed operator, whose call sign cell is blank.
      {
        headerName: 'Tactical', field: 'tacticalCall', maxWidth: 160, editable: false,
        headerTooltip: 'The tactical call the reporting station used (for example "CERT Team 1"), from the tactical calls list on the Mission page. Blank if none was used. It cannot be edited here.',
        tooltipValueGetter: (params: { data: RadioLogEntryType }) => this.operatorNameFor(params.data?.rangerUid),
      },
      // F29-44 (partial, 2026-08-29): headerName was `idFieldLabel || 'Callsign'` while field
      // stayed hardcoded "callsign" - a mission that renames its id field (e.g. to "REW")
      // rendered a column headed "REW" full of callsign data. Header now names what the
      // field actually holds. The collapse-when-callsign-is-the-key behavior (F29-44's other
      // half) is a separate, still-open decision - see the handoff doc.
      {
        headerName: 'Callsign', field: "callsign", tooltipField: "team", maxWidth: 160,
        headerTooltip: 'The reporting station\'s FCC call sign, such as K7ABC. It can be blank for members who are not licensed. Double-click to edit; a call, name or ID on the roster moves the report to that person.',
        valueSetter: (params: { data: RadioLogEntryType, newValue: any }) => this.setCallsign(params.data, params.newValue),
        cellStyle: (params: { data: RadioLogEntryType }) => {
          const key = params.data.rangerUid || params.data.callsign
          return key ? { color: rangerColorFor(key), 'font-weight': 600 } : null
        }
      },
      // E-165: the station the message went TO - "CERT Team 1 (K7ABC)", same shared format as the
      // ICS-309. Read-only in the grid for the same reason as Tactical above (to* fields are
      // recorded at save time and not re-resolved); the tooltip names the operator the same way.
      {
        headerName: 'To', colId: 'toStation', maxWidth: 200, editable: false,
        headerTooltip: 'The station the message was sent to, shown as a tactical call and call sign such as "CERT Team 1 (K7ABC)". Blank if none was given. It cannot be edited here.',
        valueGetter: (params: { data: RadioLogEntryType }) => formatStation(params.data?.toTactical, params.data?.toCallsign),
        tooltipValueGetter: (params: { data: RadioLogEntryType }) => this.operatorNameFor(params.data?.toRangerUid),
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
        tooltipField: "location.address",
        headerTooltip: 'Street address or place description for where the report came from. Free text, and it can be blank. Click to edit.'
      },
      {
        // valueSetter, not just field: "lat" - the real value lives at location.lat,
        // so without this an edit wrote a phantom top-level `lat` that nothing reads
        // and the displayed coordinate snapped back on the next refresh.
        headerName: "Lat", field: "lat", singleClickEdit: true, cellClass: 'number-cell', maxWidth: 130,
        // E-166 (2026-09-30): ARES feedback asked for the format of each column on hover.
        headerTooltip: 'Latitude in decimal degrees, shown to 4 places (for example 47.4235). Must be between -90 and 90; south is negative. Click to edit. Unlike the Entry page, this takes decimal degrees only, and a value that does not fit is ignored.',
        valueGetter: (params: { data: RadioLogEntryType }) => { return Math.round(params.data.location.lat * 10000) / 10000.0 },
        valueSetter: (params: { data: RadioLogEntryType, newValue: any }) => this.setCoordinate(params.data, 'lat', params.newValue)
      },
      {
        headerName: "Lng", field: "lng", singleClickEdit: true, cellClass: 'number-cell', maxWidth: 130,
        headerTooltip: 'Longitude in decimal degrees, shown to 4 places (for example -122.4590). Must be between -180 and 180; west is negative. Click to edit. Unlike the Entry page, this takes decimal degrees only, and a value that does not fit is ignored.',
        valueGetter: (params: { data: RadioLogEntryType }) => { return Math.round(params.data.location.lng * 10000) / 10000.0 },
        valueSetter: (params: { data: RadioLogEntryType, newValue: any }) => this.setCoordinate(params.data, 'lng', params.newValue)
      },
      // Newest first by default (John, 2026-10-21): the latest call is the top row of page 1, as on
      // the Board's viewer. Sorts on the real time, not the "M-dd" text, which puts 9-30 after
      // 10-01. Printing is unaffected: ics309-log.ts puts its rows in time order itself.
      {
        headerName: "Reported", headerTooltip: 'The date and time the entry was logged: month-day, then 24-hour time, for example 9-30 17:16:05. It cannot be edited.', valueGetter: this.myDateGetter, maxWidth: 170, editable: false,
        sort: 'desc',
        comparator: (_a: unknown, _b: unknown, nodeA: { data: RadioLogEntryType }, nodeB: { data: RadioLogEntryType }) =>
          new Date(nodeA.data.date).getTime() - new Date(nodeB.data.date).getTime(),
      },
      // E-118 (2026-09-22): same overdue ramp as the map and the Rangers grid. cellClass
      // rather than cellStyle so the colour stays in the token layer (--rt-elapsed-N via
      // the global .rt-elapsed--N in styles/_patterns.scss) instead of becoming a third
      // hard-coded copy of the palette.
      {
        headerName: "Elapsed", headerTooltip: 'How long ago the entry was logged, as hours:minutes:seconds (with days added after a day). It cannot be edited.', valueGetter: this.myMinuteGetter,
        maxWidth: 130, editable: false, cellClass: this.elapsedCellClass,
      },
      {
        headerName: "Status", field: "status",
        headerTooltip: 'The entry\'s status. Valid values are the status list set on the Mission page. Double-click to edit.', minWidth: 130, maxWidth: 220, cellRenderer: this.statusCellRenderer,
        // 2026-10-16: drawn as an inset pill (.rt-fill-cell in styles/_patterns.scss); the fill
        // travels as --rt-cell-fill rather than painting the whole cell.
        cellClass: 'rt-fill-cell',
        cellStyle: (params: { value: string; }) => {
          // Sprint E: the fill now resolves through the token layer (semantic key ->
          // --rt-status-*, custom color passes through), and an explicit ink color is set
          // alongside it. Previously only background-color was set, so the label inherited
          // whatever text color was in scope - which is unreadable on roughly half the palette.
          const stat = this.radioLogStatuses.find(el => el.status == params.value)
          const stored = stat ? stat.color : '#A3A3A3'
          return { '--rt-cell-fill': statusColorValue(stored), 'color': statusInkValue(stored) }
        }
        //cellClassRules: this.cellClassRules() }, //, maxWidth: 150
      },
      // F29-46 (2026-08-29): Source was gathered on every report since E-41 phase 1 but never
      // surfaced anywhere - a live gap this column closes. Non-editable: it's how the report
      // actually arrived, not a value a later correction should change.
      {
        headerName: "Source", field: "source", maxWidth: 110, editable: false,
        headerTooltip: 'How the message reached you: Voice, Phone, Packet, APRS or Email. It cannot be edited.'
      },
      // F29-48 (2026-08-29, D-44): same "captured but never surfaced" shape as Source above -
      // whoever was filing the report when Submit was pressed. Blank on any report that
      // predates this field, or where the scribe left it blank - both legitimate, never
      // substitute the current session's operator for a missing one.
      {
        headerName: "Operator", field: "operator", maxWidth: 140, editable: false,
        headerTooltip: 'Who was at the keyboard logging the entry (not who sent the report). Set when the entry is logged, blank if none was set, and it cannot be edited.'
      },
      // The ONLY flex column, on purpose - see autoSizeStrategy above. Notes is both the
      // most variable-length field and the one a scribe most wants extra room for, so it
      // takes whatever width the content-sized columns leave behind. minWidth raised from
      // 200 to 260 (raised live, 2026-08-27) - longer entries were getting squeezed toward
      // the old floor by the other columns' own content-driven widths.
      {
        headerName: "Notes", field: "notes", cellRenderer: this.notesCellRenderer, flex: 1, minWidth: 260,
        headerTooltip: 'What was said, in your own words. Free text, and it can be blank. Double-click to edit.',
        tooltipField: "notes"
      },
      // E-220 / E-218: the message number's parts and the mark's words, for the CSV export only.
      ...MSG_NO_CSV_COLUMNS.map(key => ({
        colId: key, headerName: key, hide: true, suppressColumnsToolPanel: true,
        valueGetter: (params: { data: RadioLogEntryType }) => msgNoCsvFields(params.data ?? {})[key],
      })),
      // E-194: two columns that exist for the CSV export only (hidden on screen; the 📎 chip in the
      // Notes cell is the on-screen face of the same data). onBtnExport() adds them to the export.
      {
        colId: 'attachmentCount', headerName: 'Attachments', hide: true, suppressColumnsToolPanel: true,
        valueGetter: (params: { data: RadioLogEntryType }) => liveRefs(params.data ?? {}).length,
      },
      {
        colId: 'attachmentFiles', headerName: 'Attachment files', hide: true, suppressColumnsToolPanel: true,
        valueGetter: (params: { data: RadioLogEntryType }) => liveRefs(params.data ?? {}).map(nameWithKind).join('; '),
      },
      // E-11 (2026-08-26): evidenceLocation was captured on Entry and visible nowhere
      // afterward - not the main map, not here. This is the other of the two places the
      // gap named; see mapLeaflet.component.ts's displayMarkers() for the main-map marker.
      {
        headerName: "Evidence", field: "evidenceLocation", maxWidth: 110, editable: false,
        headerTooltip: 'Shows a mark if the entry includes the location of evidence or a clue; hover the mark for its coordinates. Blank if none. It cannot be edited.',
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
    // Stable row identity, so a new rowData array (gotNewRadioLog) updates rows in place and
    // keeps the selection, instead of rebuilding the grid on every cell edit.
    getRowId: (params) => String(params.data.id),
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
    // E-144 follow-up: pinned so gridHeight() can size the grid to its rows exactly.
    rowHeight: RadioLogComponent.GRID_ROW_PX,
    headerHeight: RadioLogComponent.GRID_HEADER_PX,
    floatingFiltersHeight: RadioLogComponent.GRID_HEADER_PX,
    paginationAutoPageSize: true, // if set overrides paginationPageSize & forces it back to this on changes...
    //paginationPageSize: 5,
    // suppressScrollOnNewData: true, // grid to NOT scroll to the top, on page changes

    // E-166 (2026-09-30): without a delay setting, AG Grid waits its default ~2 s before showing
    // ANY tooltip, which made the new column header explanations look broken. Short, so a
    // hover shows it, but not so short that sweeping the mouse across the header flickers.
    tooltipShowDelay: 300,

    // EVENT handlers
    onSelectionChanged: (event: SelectionChangedEvent) => this.onRowSelection(event),
    onFilterChanged: () => this.refreshFilterChips(),
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

  private attachmentStore = inject(AttachmentStoreService)
  private devicePrefs = inject(DevicePrefsService)
  private importSafety = inject(ImportSafetyService)
  private attachmentViewer = inject(AttachmentViewerService)
  /** E-196 (D-66): the mode decides the catch-up wording and the import warnings. */
  protected usage = inject(UsageStateService)
  private aarNoteService = inject(AarNoteService)
  protected journal = inject(MissionJournalService)
  private snackBar = inject(MatSnackBar)

  constructor(
    private radioLogService: RadioLogService,
    private log: LogService,
    // private teamService: TeamService,
    private rangerService: RangerService,
    private missionService: MissionService,
    private recordStore: RecordStore,
    private locationService: MissionLocationService,
    private photoService: RangerPhotoService,
    private dialog: MatDialog,
    public fieldMode: FieldModeService,
    @Inject(DOCUMENT) private document: Document
  ) {
    ensureAgGridRegistered()

    this.now = new Date()
    this.gridApi = ""
    this.gridColumnApi = ""

    this.phoneMediaQuery.addEventListener('change', this.onPhoneMediaChange)
  }


  /**
   * E-165: the operator's name for a Tactical/To cell's hover, from the live roster by uid -
   * undefined (no tooltip) when the entry has no roster link or that member is gone.
   */
  private operatorNameFor(uid: string | undefined): string | undefined {
    if (!uid) return undefined
    return this.rangerService.rangers.find(r => r.uid === uid)?.fullName || undefined
  }

  /** E-165: From station for the phone cards - tactical and/or FCC call, in the shared format. */
  stationFrom(report: RadioLogEntryType): string {
    return formatStation(report.tacticalCall, report.callsign)
  }

  /** E-165: To station for the phone cards and the 309; blank when none was recorded. */
  stationTo(report: RadioLogEntryType): string {
    return formatStation(report.toTactical, report.toCallsign)
  }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  ngOnInit(): void {


    // https://angular.io/tutorial/toh-pt4#call-it-in-ngoninit states subscribes should happen in OnInit()
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.columnDefs = this.buildColumnDefs()
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id)
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
        this.gotNewRadioLog(newReport)
      },
      error: (e) => this.log.error('Radio Log entries Subscription got:' + e, this.id)
    })

    if (this.gridApi) {
      this.gridApi.refreshCells()
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
    const status = escapeHtml(params.data.status)
    return `<span aria-hidden title="Status: ${status}"> ${status}</span>`
  }

  notesCellRenderer = (params: { data: RadioLogEntryType }) => {
    const notes = escapeHtml(params.data.notes)
    // E-194: the 📎 N chip rides inside the notes cell (no new wide column); its click is caught
    // by onGridClick() below, since a cell renderer here is a string. 2026-10-27: a flex row, so a
    // long note ellipsises its own text and the chip keeps its width (it used to be cut off).
    const chip = attachmentChipHtml(params.data)
    if (!chip) return `<span aria-hidden title="Note: ${notes}"> ${notes}</span>`
    return `<span class="rt-notes-cell"><span class="rt-notes-cell__text" aria-hidden title="Note: ${notes}"> ${notes}</span>${chip}</span>`
  }

  /** E-194: opens the viewer for the ONE selected row, the way to add files to an entry that has none yet. */
  onBtnAttachments(): void {
    const rows = this.gridApi?.getSelectedNodes() ?? []
    if (rows.length !== 1) return
    void this.attachmentViewer.open((rows[0].data as RadioLogEntryType).uid)
  }

  /** E-194: a click on a 📎 chip inside the grid opens the viewer for that row's entry. */
  onGridClick(event: Event): void {
    const uid = attachmentChipUid(event)
    if (uid) void this.attachmentViewer.open(uid)
  }

  /** E-218: the status mark's glyph, or an empty box; a button for assistive tech with the mark in its label. */
  handledCellRenderer = (params: { data: RadioLogEntryType }) => {
    const h = params.data?.handled
    const label = h ? `Status mark: ${HANDLED_MARK_LABEL[h.mark]}. Click to change.` : 'Status mark: none. Click to mark handled.'
    return `<span role="button" tabindex="0" class="rt-mark-cell" aria-label="${label}">${h ? HANDLED_MARK_GLYPH[h.mark] : '&#9744;'}</span>`
  }

  /** E-218: a click on the mark cell moves it one step round the cycle and saves. */
  private onHandledClicked(params: { data: RadioLogEntryType, node: any, api: any }): void {
    if (!params.data) return
    this.radioLogService.cycleHandledMark(params.data)
    params.api.refreshCells({ rowNodes: [params.node], force: true })
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
    if (isScenarioEntry(params.data)) return `<span aria-hidden title="${SCENARIO_MARK_TITLE}">🎬</span>`
    return `<span aria-hidden title="Merged in from another device - not typed on this device">📦</span>`
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

    this.gridApi = params.api
    this.gridColumnApi = params.columnApi
    this.refreshFilterChips()

    // E-104: `sizeColumnsToFit()` used to run here, and it is what actually produced the
    // reported defect - it distributes the grid's width across columns and IGNORES the
    // per-column `flex` weights, so `Address` (flex 30) rendered narrower than `Lat`
    // (flex 1). `autoSizeStrategy` in gridOptions does the sizing now, once, from content.

    // TODO: use this line, or onFirstDataRendered()?
    if (this.gridApi) {
      this.gridApi.refreshCells()
    }


    // set initial pagination size
    //paginationAutoPageSize: true
    // this.gridApi.paginationAutoPageSize(true) // also see: onRowsPerPage

  }

  onFirstDataRendered(params: any) {

    // following should not be needed, duplicate of onGridReady()...
    this.gridApi = params.api
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

  /**
   * E-122 Phase 2a: awaits `recordStore.flush()` first - see RangersComponent.reloadPage()'s
   * own doc comment for the full reasoning (radio log entries now persist to IndexedDB async).
   */
  async reloadPage() {
    this.log.verbose(`Reloading window!`, this.id)
    await this.recordStore.flush()
    window.location.reload()
  }


  gotNewRadioLog(newReports: RadioLogType) {

    this.radioLog = newReports
    // A fresh array: the service pushes onto logEntries in place (mergeIncomingEntries), so
    // passing the same reference was a no-op for the signal and the grid never saw a merged
    // Report Packet until the page was reopened.
    this.radioLogEntries.set([...newReports.logEntries])
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

    try {  // TODO: Use the date pipe instead?
      //weekday[d.getDay()] +
      dt = formatDate(d, 'M-dd HH:mm:ss', 'en-US')
    } catch (error: any) {
      dt = `Bad date format: Error name: ${error.name}; msg: ${error.message}`
    }

    // https://www.w3schools.com/jsref/jsref_obj_date.asp
    /*
        if (this.isValidDate(d)) {
          dt = weekday[d.getDay()] + formatDate(d, 'yyyy-MM-dd HH:mm:ss', 'en-US')
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

  isValidDate(d: any) {
    return d instanceof Date //&& !isNaN(d);
  }

  // filteredReports:RadioLogEntryType[] = this.radioLogService.filterFieldReportsByDate(Date(-12*60*60*1000), Date(5*60*1000)) //FUTURE:
  // onBtnSetSelectedRowData() {
  //   let selectedNodes = this.gridApi.getSelectedNodes();
  //   let selectedData = selectedNodes.map((node: { data: RadioLogEntryType; }) => node.data);
  //   this.selectedRows = selectedNodes.length
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
    // Was `FieldReportsExport.2026 -10 -15_9:5.csv`: spaces, unpadded parts and a colon, which
    // Windows can't have in a file name. Same shape as the roster export's name now.
    const dt = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    return {
      columnSeparator: this.getParamValue('columnSeparator'),
      fileName: `rangertrak-radio-log-${stamp}.csv`,
    }
  }

  onSeperatorChange() {
    var params = this.getParams();
    if (params.columnSeparator && this.numSeperatorWarnings++ < this.maxSeperatorWarnings) {
      alert(`NOTE: Excel handles comma separators best.You've chosen "${params.columnSeparator}"`)
    }
  }

  /** E-190: re-reads the grid's filters into chips and recounts the rows that get through them. */
  private refreshFilterChips(): void {
    if (!this.gridApi?.getFilterModel) return
    const headerFor = (colId: string): string =>
      this.gridApi.getColumn(colId)?.getColDef().headerName ?? colId
    this.filterChips.set(describeGridFilters(this.gridApi.getFilterModel(), headerFor))
    let shown = 0
    this.gridApi.forEachNodeAfterFilter?.(() => shown++)
    this.shownCount.set(shown)
  }

  async onClearFilter(colId: string): Promise<void> {
    await this.gridApi?.setColumnFilterModel(colId, null)
    await this.gridApi?.onFilterChanged()
  }

  onClearAllFilters(): void {
    this.gridApi?.setFilterModel(null)
  }

  onBtnExport() {
    // Was exportDataAsExcel, which is ag-grid ENTERPRISE: this app registers only
    // AllCommunityModule (shared/ag-grid-setup.ts), so the button logged a console error and
    // wrote no file at all. CSV is Community, and the card's separator picker always meant CSV.
    // Order (John, 2026-10-15; D-58): "All rows" ticked -> every row; else the selected rows if
    // any; else what the grid shows (every row unfiltered, the filtered rows with a filter -
    // the chips above the grid make the filter visible). Reads signals, not the DOM.
    const onlySelected = !this.allRows() && this.selectedRows() > 0
    const params = this.getParams()
    this.gridApi.exportDataAsCsv({
      ...params,
      // E-194: what the grid shows, plus the two hidden attachment columns.
      // E-220: the two on-screen columns for the number and mark give way to the full-form CSV columns.
      columnKeys: [
        ...this.gridApi.getAllDisplayedColumns().map((c: any) => c.getColId())
          .filter((id: string) => id !== 'handledMark' && id !== 'msgNo'),
        ...MSG_NO_CSV_COLUMNS, 'attachmentCount', 'attachmentFiles',
      ],
      fileName: onlySelected ? params.fileName.replace(/\.csv$/, '-selected.csv') : params.fileName,
      exportedRows: this.allRows() ? 'all' : 'filteredAndSorted',
      onlySelected,
    })
    this.journal.record('radio-log-exported', `Exported the radio log to ${onlySelected ? params.fileName.replace(/\.csv$/, '-selected.csv') : params.fileName}.`)
  }


  /**
   * E-114 Phase 1: builds a Report Packet of every radio log entry currently on this device and
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
      alert('There are no radio log entries on this device to package.')
      return
    }
    const { text, filename, count } = built
    // D-60 item 6: the originals this device holds go beside the .txt, in the same share.
    const media = await this.radioLogService.reportPacketMedia()
    const outcome = await sendReportPacket(text, filename, media, this.document,
      (why) => this.log.warn(`Sharing the Report Packet was cancelled or failed, so it was downloaded instead: ${why}`, this.id))
    if (outcome === 'downloaded') {
      this.journal.record('packet-exported', `Downloaded Report Packet: ${filename} (${count} reports, ${media.length} files).`)
      return
    }
    this.journal.record('packet-exported', `Shared Report Packet: ${filename} (${count} reports, ${outcome === 'shared' ? media.length : 0} files).`)
    if (outcome === 'shared-text-only') alert(PHOTOS_LEFT_OUT_MESSAGE)
  }

  // ── E-188 scribe hand-over (ADR D-59) ────────────────────────────────────────────────────
  /** Optional passphrase for the hand-over file; blank writes it unencrypted, as Back up does. */
  handoverPass = signal('')
  handoverPassAgain = signal('')
  handoverBusy = signal(false)
  /** What the last merge did, named (never a bare count). Shown under the card. */
  handoverSummary = signal('')
  handoverError = signal('')

  /** Builds and downloads the hand-over file: the whole roster (with photos), all places and ALL entries. */
  async onBtnBuildHandover(): Promise<void> {
    this.handoverError.set('')
    const passphrase = this.handoverPass()
    if (passphrase !== this.handoverPassAgain()) {
      this.handoverError.set('The two passphrases are different. Type the same one in both boxes, or leave both blank.')
      return
    }
    const entries = this.radioLogService.getCurrentRadioLog().logEntries
    if (!entries.length) {
      this.handoverError.set('There are no radio log entries on this device to hand over.')
      return
    }

    this.handoverBusy.set(true)
    try {
      const settings = this.missionService.settings
      const file = await buildHandoverFile({
        mission: settings.mission, event: settings.event, opPeriod: settings.opPeriod,
        appVersion: JSON.parse(JSON.stringify(packageJson)).version,
        rangers: this.rangerService.rangers,
        locations: this.locationService.getCurrentLocations(),
        entries,
        photos: await this.photoService.allPhotoBlobs(),
        attachments: await this.attachmentBytesFor(entries),
        passphrase,
      })
      const blob = new Blob([file.bytes as BlobPart], { type: file.mime })
      const url = URL.createObjectURL(blob)
      const a = this.document.createElement('a')
      a.href = url
      a.download = file.filename
      a.click()
      URL.revokeObjectURL(url)
      this.journal.record('handover-built', `Built hand-over file: ${file.filename} (${entries.length} entries, `
        + `${this.rangerService.rangers.length} people)${file.encrypted ? ' (encrypted)' : ' (NOT encrypted)'}.`)
      this.handoverSummary.set(`Saved ${file.filename}: ${entries.length} radio log entries and `
        + `${this.rangerService.rangers.length} people${file.encrypted ? ', locked with your passphrase' : ', NOT locked'}.`)
    } catch (e: any) {
      this.log.error(`Could not build the hand-over file: ${e?.message ?? e}`, this.id)
      this.handoverError.set(`Could not build the file. ${e?.message ?? e}`)
    } finally {
      this.handoverBusy.set(false)
    }
  }

  /**
   * E-194: the bytes of every live attachment this device holds, once per fingerprint, for the
   * hand-over's `attachments/` folder. Removed ones are not sent (their bytes are gone anyway).
   * Read one at a time and held for the zip, which is built in memory.
   */
  private async attachmentBytesFor(entries: readonly RadioLogEntryType[]): Promise<AttachmentFile[]> {
    const out: AttachmentFile[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      for (const ref of liveRefs(entry)) {
        if (seen.has(ref.sha256) || !(await this.attachmentStore.has(ref.sha256))) continue
        seen.add(ref.sha256)
        const blob = await this.attachmentStore.getOriginal(ref.sha256)
        out.push({ sha256: ref.sha256, name: ref.name, type: ref.type, bytes: new Uint8Array(await blob.arrayBuffer()) })
      }
    }
    return out
  }

  /** Reads a picked hand-over file, previews it in a dialog, and on confirm merges people, places, then entries. */
  async onHandoverFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event
    if (!file) {
      return
    }
    this.handoverError.set('')

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { HandoverDialogComponent } = await import('./handover-dialog/handover-dialog.component')
      const ref = this.dialog.open(HandoverDialogComponent, {
        width: '56rem', maxWidth: '95vw', data: { fileName: file.name, bytes },
      })
      const result: HandoverDialogResult | undefined = await new Promise(resolve => ref.afterClosed().subscribe(r => resolve(r)))
      if (!result) {
        this.log.verbose('onHandoverFileSelected: cancelled.', this.id)
        return
      }
      await this.applyHandover(file.name, result)
    } catch (e: any) {
      this.log.error(`Could not merge "${file.name}": ${e?.message ?? e}`, this.id)
      this.handoverError.set(`Could not merge "${file.name}". ${e?.message ?? e}`)
    }
  }

  /** People first, then places and photos, then the entries (remapped to the uids the people merge kept). */
  private async applyHandover(fileName: string, result: HandoverDialogResult): Promise<void> {
    const parts: string[] = []
    if (result.rangerMerge) {
      this.rangerService.replaceAllRangers(result.rangerMerge.rangers)
      this.rangerService.recordMergeImport(fileName, result.rangerMerge)
      parts.push(describeRangerMerge(result.rangerMerge))
    }
    if (result.locationMerge) {
      this.locationService.replaceAllLocations(result.locationMerge.locations)
      parts.push(describeLocationMerge(result.locationMerge))
    }
    if (result.photos.length) {
      const mimeFor = (name: string) => {
        const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
        return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      }
      const photoFiles = result.photos.map(p => new File([p.bytes as BlobPart], p.filename, { type: mimeFor(p.filename) }))
      const { stored, unmatched } = await this.photoService.importFiles(photoFiles, this.rangerService.rangers)
      parts.push(`${stored.length} photo${stored.length === 1 ? '' : 's'} stored`
        + (unmatched.length ? `, ${unmatched.length} unmatched` : ''))
    }

    // E-220 / D-68: the letter is set BEFORE the merge, so an entry in the file that has no number yet
    // is stamped as the station this device now logs as. Numbered entries keep theirs either way.
    if (result.station) this.devicePrefs.setMsgStation(result.station)
    const entries = this.radioLogService.mergeHandoverEntries(
      result.manifest.entries ?? [], result.rangerMerge?.uidRemap ?? {})
    const bits = [`${entries.added} added`]
    if (entries.updated) {
      bits.push(`${entries.updated} updated (${entries.updatedNotes.map(n => `#${n.id} ${n.callsign}`).join(', ')})`)
    }
    bits.push(`${entries.unchanged} already here`)
    if (entries.rejected) {
      bits.push(`${entries.rejected} could not be read (${entries.rejectedNotes.map(n => n.callsign || '?').join(', ')})`)
    }
    parts.push(`radio log entries: ${bits.join('; ')}`)
    if (result.station) parts.push(`this device now logs as station ${result.station}`)
    const clashLine = msgNoClashSentence(entries.clashes)
    if (clashLine) parts.push(clashLine.replace(/\.$/, ''))

    // E-194 / D-60: the bytes for the merged references, each re-hashed (putVerified) so a bad file
    // is named and never stored; then the bytes a merged-in removal made unwanted go.
    if (result.attachments.length) {
      const merged = this.radioLogService.getCurrentRadioLog().logEntries
      const att = await this.attachmentStore.restoreVerified(result.attachments, merged)
      await this.attachmentStore.releaseRemoved(merged)
      parts.push(`${att.stored} attachment${att.stored === 1 ? '' : 's'} stored`
        + (att.mismatched.length ? `, ${att.mismatched.length} did not match their fingerprint and were NOT stored (${att.mismatched.join(', ')})` : ''))
    } else {
      await this.attachmentStore.releaseRemoved(this.radioLogService.getCurrentRadioLog().logEntries)
    }

    const summary = `Merged "${fileName}": ${parts.join('. ')}.`
    // E-223: the summary names people, places and entries; the log keeps counts only.
    this.journal.record('handover-merged', `Merged the hand-over file "${fileName}": `
      + `${result.rangerMerge ? `${result.rangerMerge.added.length} people added, ${result.rangerMerge.overwritten.length} updated; ` : ''}`
      + `${result.locationMerge ? `${result.locationMerge.added.length} places added, ${result.locationMerge.overwritten.length} updated; ` : ''}`
      + `${result.photos.length} photos offered; `
      + `${entries.added} entries added, ${entries.updated} updated, ${entries.unchanged} unchanged, ${entries.rejected} rejected.`)
    this.handoverSummary.set(summary)
  }

  /** E-196 (D-66): the scenario mark's hover text, also used by the phone cards. */
  protected readonly scenarioMarkTitle = SCENARIO_MARK_TITLE
  protected isScenario = isScenarioEntry

  /** E-196 (D-66): the scenario time line on the printed 309, '' unless Exercise mode with a clock. */
  protected scenarioLine(preparedAt: Date): string { return this.usage.scenarioLabelAt(preparedAt) }

  /** Reads a picked Report Packet file and hands it to `mergeIncomingEntries()` (E-114 Phase
   *  0). No confirm() dialog needed - a merge only ADDS new entries and never touches an
   *  existing one, unlike every other import on this page's own Danger Zone.
   *
   *  D-60 item 6: the picker takes the `.txt` and the photos, audio and video that came with it
   *  together. The entries are merged first; then each other file is hashed and stored only if a
   *  live reference on this device names its fingerprint. Media alone (they arrived later) also
   *  works. */
  async onReportPacketFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const picked = Array.from(input.files ?? [])
    input.value = '' // so re-picking the same file still fires a change event
    if (!picked.length) {
      return
    }
    const isPacket = (f: File) => f.type === 'text/plain' || f.type === 'application/json' || /\.(txt|json)$/i.test(f.name)
    const file = picked.find(isPacket)
    const media = picked.filter(f => f !== file)

    try {
      if (!file) {
        alert(this.mediaOnlyMessage(await this.radioLogService.storePacketMedia(media)))
        return
      }
      // E-198: say plainly what is wrong with the file (cut off, a backup, from a newer RangerTrak...)
      // before trying to read it; the technical reason goes to the log only.
      const diagnosis = await diagnoseFile(file, 'report-packet',
        { backup: MISSION_EXPORT_SCHEMA_VERSION, reportPacket: REPORT_PACKET_SCHEMA_VERSION })
      if (diagnosis.problem !== 'none') {
        this.log.error(`Could not read "${file.name}" as a Report Packet: ${diagnosis.technical}`, this.id)
        alert(`Could not read "${file.name}".\n\n${diagnosis.message}`)
        return
      }
      let packet: ReturnType<typeof parseReportPacket>
      try {
        packet = parseReportPacket(await file.text())
      } catch (parseError: any) {
        this.log.error(`Could not read "${file.name}" as a Report Packet: ${parseError?.message ?? parseError}`, this.id)
        alert(`Could not read "${file.name}".\n\n${REPORT_PACKET_DAMAGED_MESSAGE}`)
        return
      }

      // E-196 (D-66): a catch-up file from the exercise console. Warn, never block (D-46).
      const isCatchUp = packet.event === 'EXERCISE'
      const inExercise = this.usage.mode() === 'exercise'
      if (isCatchUp && !inExercise) {
        if (!confirm('This file is EXERCISE training traffic. This mission is not an exercise, so these '
          + 'entries would sit in a real log. Import it anyway?')) {
          this.log.verbose('onReportPacketFileSelected: user cancelled an EXERCISE file outside Exercise mode.', this.id)
          return
        }
      }

      const currentMission = this.settings?.mission?.trim()
      // In Exercise mode a catch-up file is expected to name a different mission, so no question.
      if (!(isCatchUp && inExercise) && currentMission && packet.mission && packet.mission.trim() !== currentMission) {
        if (!confirm(
          `This Report Packet says "${packet.mission}", but this device's current mission `
          + `is "${currentMission}".\n\nImport its ${packet.entries.length} report`
          + `${packet.entries.length === 1 ? '' : 's'} anyway?`)) {
          this.log.verbose('onReportPacketFileSelected: user cancelled on mission mismatch.', this.id)
          return
        }
      }

      // E-198: the device as it is now, kept for 24 hours, before the merge changes anything.
      const safetyCopy = await this.importSafety.ensureBeforeImport('report-packet', file.name)
      if (safetyCopy === 'cancelled') {
        this.log.verbose('onReportPacketFileSelected: no safety copy and the user chose not to continue.', this.id)
        return
      }

      const { added, skipped, rejected, clashes } = this.radioLogService.mergeIncomingEntries(packet.entries, packet.operator)
      const lines = isCatchUp && inExercise
        ? [`Added ${added} scenario entr${added === 1 ? 'y' : 'ies'} (${skipped} already here).`]
        : [`Merged ${added} new report${added === 1 ? '' : 's'} from "${file.name}".`]
      if (media.length || packet.entries.some(e => e.attachments?.length)) {
        lines.push(...mediaSummary(await this.radioLogService.storePacketMedia(media, packet.entries)))
      }
      if (skipped && !(isCatchUp && inExercise)) {
        lines.push(`${skipped} already present on this device were skipped.`)
      }
      if (rejected) {
        lines.push(`${rejected} report${rejected === 1 ? '' : 's'} could not be read (bad timestamp or location) and were NOT imported - see the Log page for which.`)
      }
      // E-220 / D-68: two entries with one number are named, not renumbered.
      const clashLine = msgNoClashSentence(clashes ?? [])
      if (clashLine) lines.push(clashLine)
      if (safetyCopy === 'kept') {
        await this.importSafety.markImportDone()
        lines.push('Undo is in Mission > Data safety for 24 hours.')
      }
      alert(lines.join('\n'))

      // E-196 (D-66): offer the file's scenario clock whenever it differs from the mission's.
      if (isCatchUp && inExercise && packet.scenarioClock
        && !sameScenarioClock(packet.scenarioClock, this.usage.scenarioClock())) {
        const label = formatScenarioTime(scenarioTimeAt(packet.scenarioClock, Date.now()))
        if (confirm(`Set the scenario clock to ${label}?`)) this.usage.saveScenarioClock(packet.scenarioClock)
      }
    } catch (e: any) {
      const label = file?.name ?? 'those files'
      this.log.error(`Could not read "${label}" as a Report Packet: ${e?.message ?? e}`, this.id)
      alert(`Could not read "${label}".\n\n${e?.message ?? e}`)
    }
  }

  /** The words for files loaded with no packet: nothing to merge, just attachments to match up. */
  private mediaOnlyMessage(r: { added: number, unmatched: number, remote: number }): string {
    return mediaSummary({ ...r, remote: 0 }).join('\n') || 'Nothing was added.'
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
  /** E-194: object URLs of the stored thumbnails for the attachments on the 309 being printed. */
  public printThumbs = signal<Record<string, string>>({})

  async onBtnPrint309() {
    const reports = this.reportsForPrintScope()
    if (!reports.length) {
      alert(this.printScope() === 'sincePrint' && !this.settings?.lastPrintedAt
        ? 'No reports to print - nothing has been filed yet.'
        : 'No reports match that scope - nothing to print.')
      return
    }

    const log = buildIcs309Log(reports, {
      mission: this.settings.mission,
      event: this.settings.event,
      opPeriod: this.settings.opPeriod,
      opPeriodStart: this.settings.opPeriodStart,
      opPeriodEnd: this.settings.opPeriodEnd,
    })
    // E-194: images print their stored thumbnail beside the list; read before the block renders.
    const thumbs: Record<string, string> = {}
    for (const row of log.rows) {
      for (const a of row.attachments) {
        if (a.isImage && !(a.sha256 in thumbs)) thumbs[a.sha256] = await this.attachmentStore.thumbUrl(a.sha256).catch(() => '')
      }
    }
    this.printThumbs.set(thumbs)
    // E-222: recorded before the block renders, so the head printed on the sheet includes this print.
    this.journal.record('print-309', `Printed the ICS-309 log: ${reports.length} rows, scope "${this.printScope()}".`)
    this.ics309Log.set(log)

    // A tick to let the print-only block (bound to the signal just set) actually render
    // before the browser's print dialog captures the page - `window.print()` right after a
    // signal write isn't guaranteed to see the updated DOM. Same reasoning as elsewhere in
    // this app that defers a native browser action by one tick after a state change.
    setTimeout(() => {
      // 2026-09-25: the navbar, page header and footer used to print above and below the log
      // (both layouts). A 309 handed to an EOC should be the form alone - styles.scss hides
      // the app chrome under @media print while this class is on <body>. Scoped to this one
      // print so the Map page's own print output is unaffected. window.print() blocks until
      // the dialog closes in every browser this app supports, so removing the class right
      // after it is safe; 'afterprint' is the belt to that brace.
      showFirstPrintTip() // 2026-09-30, John: once per device, see print-tip.ts
      document.body.classList.add('rt-print-309')
      window.addEventListener('afterprint', () => document.body.classList.remove('rt-print-309'), { once: true })
      const untitle = armPrintTitle('ICS-309', this.settings) // E-172, see print-title.ts
      window.print()
      untitle()
      document.body.classList.remove('rt-print-309')
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

  formatLogDate(date: Date | string): string {
    return new Date(date).toLocaleDateString()
  }

  formatLogDateTime(date: Date | string): string {
    const d = new Date(date)
    return `${d.toLocaleDateString()} ${this.formatLogTime(d)}`
  }

  async onBtnClearRadioLog() {
    // E-221: the dialog says how many attachments go with the entries and offers the notes and
    // 214 lines (kept unless ticked).
    const clear = await this.usage.chooseWhatToClear('log', 'Delete radio log entries and messages?', 'Delete radio log')
    if (!clear) return
    const counts = this.usage.clearCounts()   // E-223: for the log, taken before anything goes
    await this.radioLogService.deleteAllRadioLogEntries()
    this.aarNoteService.deleteWhere(noteMatcher(clear))
    this.journal.record('radio-log-cleared', `Cleared the radio log. ${clearedPlain('log', clear, counts)}`)
    this.refreshGrid()
    this.reloadPage()
  }

  /**
   * A cell was edited: persist to localStorage and republish, so the maps and
   * any other subscriber see the correction immediately. Replaces the old
   * "Save Reports" button, which the page itself described as something that
   * "should happen automatically".
   */
  private onCellEdited() {
    this.log.info(`Edited a radio log entry in the grid.`, this.id)
    this.radioLogService.saveEditedRadioLog()
  }

  /**
   * A Callsign edit re-links the report to the roster ranger it now names (domain/ranger-match),
   * so colour, map trail and the operator tooltips follow the correction. Journalled (D-67)
   * because it changes who a report is attributed to. Returns false for no change, so the grid
   * skips the save.
   */
  private setCallsign(report: RadioLogEntryType, newValue: any): boolean {
    const edit = applyCallsignEdit(report, newValue, this.rangerService.rangers)
    if (!edit.changed) return false
    const from = edit.oldCallsign || '(blank)'
    const to = edit.newCallsign || (edit.ranger ? '(no call sign)' : '(blank)')
    this.journal.record('report-reassigned', `Changed the call sign on report ${report.id} from ${from} to ${to}`
      + (edit.ranger ? '.' : ', which matches no one on the roster.'))
    const notice = callsignEditNotice(edit, report.tacticalCall)
    if (notice) this.snackBar.open(notice, 'OK', { duration: 8000 })
    return true
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
      this.log.warn(`Ignored an invalid ${axis} "${newValue}" for report ${report.id}.`, this.id)
      return false
    }

    report.location[axis] = parsed
    // An edited coordinate is no longer whatever the address geocoded to.
    report.location.derivedFromAddress = false
    return true
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
        //this.gridApi.paginationSetPageSize()
        this.gridApi.paginationAutoPageSize = true
        this.gridApi.redrawRows()
        break;
      case "5":
        //! WORKS! - Maybe any number LESS than auto????
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("5")
        break;
      case "10":
        // WORKS! - Maybe any number LESS than auto????
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("10")
        break;
      case "25":
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("25")
        break;
      case "50":
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("50")
        break;
      case "100":
        this.gridApi.paginationAutoPageSize = false
        this.gridApi.paginationSetPageSize("100")
        break;
      case "All":
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
