import { AgGridModule } from 'ag-grid-angular'
import { ColDef, GridOptions } from 'ag-grid-community'

import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges
} from '@angular/core'
import { MATERIAL_IMPORTS } from '../../../material-imports'

import { ensureAgGridRegistered } from '../../../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../../../shared/ag-grid-theme'
import {
  RadioLogService, RadioLogStatusType, LogService, statusColorMeetsAA, statusColorValue,
  statusInkValue
} from '../../../shared/services/'
import { ColorEditor } from '../../color-editor.component'

/**
 * The Radio Log entry status/color ag-Grid editor. Sprint C split out of the 429-line
 * mission.component template - see mission.component.ts for the rest.
 *
 * `rowData` is the same array reference the parent's `settings.radioLogStatuses` (and
 * the `radioLogStatuses` form control) point at - grid edits mutate it in place, exactly
 * as the monolithic component did. `ngOnChanges` re-syncs the local reference when the
 * parent reassigns it wholesale (import / reset), mirroring what the parent's settings
 * subscription already does.
 *
 * E-73: the Status column used to be always-editable next to a static warning paragraph
 * ("don't edit status names if they've already been used") - a rule stated in prose, never
 * enforced. `isStatusInUse()` checks `RadioLogService`'s current in-memory reports
 * directly rather than tracking separate "used" state, since `FieldReportType.status` is
 * already the exact status name string - no new persistence needed. Read fresh on every
 * edit attempt (AG Grid calls `editable` per cell, right before it would start editing),
 * so a report added while this grid is open is picked up without any extra wiring.
 */
@Component({
  selector: 'rangertrak-mission-field-report-statuses',
  standalone: true,
  imports: [CommonModule, AgGridModule, ...MATERIAL_IMPORTS],
  templateUrl: './mission-field-report-statuses.component.html',
  styleUrls: ['./mission-field-report-statuses.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionFieldReportStatusesComponent implements OnChanges {
  private id = 'Mission Radio Log Statuses Component'

  @Input({ required: true }) rowData: RadioLogStatusType[] = []

  /**
   * Asks the Mission page to save and reload (its onFormSubmit()), which is what makes an
   * added row persist and show up. Until 2026-09-26 this happened by accident: the button had
   * no `type`, so inside Mission's form every click ALSO submitted it. The card rework gave
   * the button `type="button"`, which would have silently lost every added row - so the save
   * is explicit now, with the same result users already saw.
   */
  @Output() rowAdded = new EventEmitter<void>()

  private gridApi: any
  private gridColumnApi: any

  // https://www.ag-grid.com/angular-data-grid/grid-interface/#grid-options-1
  // https://www.ag-grid.com/javascript-data-grid/row-styles/#highlighting-rows-and-columns
  gridOptions: GridOptions = {
    theme: rangertrakGridTheme,
  }

  defaultColDef: ColDef = {
    flex: 1, //https://ag-grid.com/angular-data-grid/column-sizing/#column-flex
    minWidth: 30,
    editable: true,
    singleClickEdit: true,
    resizable: true,
    sortable: true,
    filter: true,
  }

  //? FUTURE: Consider replacing "Color" with "CSS_Style" to allow more options?
  columnDefs = [
    {
      headerName: "Status", field: "status", flex: 50,
      editable: (params: { data: RadioLogStatusType }) => !this.isStatusInUse(params.data.status),
      cellStyle: (params: { value: string; }) => {
        // Same fill+ink resolution as the Radio Log entries grid - see field-reports.component.ts.
        const stat = this.rowData.find(el => el.status == params.value)
        const stored = stat ? stat.color : '#A3A3A3'
        const style: Record<string, string> = {
          'background-color': statusColorValue(stored), 'color': statusInkValue(stored)
        }
        // E-73: a disabled-looking cell that never explains itself is its own defect - this
        // is visible *before* a scribe tries to type and gets silently refused, not just a
        // cursor change on hover.
        if (this.isStatusInUse(params.value)) {
          style['opacity'] = '0.6'
          style['cursor'] = 'not-allowed'
        }
        return style
      },
      tooltipValueGetter: (params: any) =>
        this.isStatusInUse(params.value)
          ? `"${params.value}" is used on at least one radio log entry this mission and can't be renamed. Add a new status instead.`
          : undefined,
    },
    {
      headerName: "Color", field: "color",
      tooltipField: "one of the built-in accessible colors, or your own CSS color",
      cellStyle: (params: { value: string; }) => {
        // Raised live 2026-08-27: this called refreshStatusGrid() on every invocation - but
        // cellStyle is itself invoked BY refreshCells()/normal rendering, so this fired once
        // per Color cell on every render pass (11 times in a row on page load, one per
        // status row - exactly the "no this.gridApi yet" log noise reported before the grid
        // API is even wired up). cellStyle must stay a pure read of `params.value`; it has no
        // reason to trigger a grid refresh at all.
        const stored = String(params.value ?? '')
        return {
          backgroundColor: statusColorValue(stored),
          color: statusInkValue(stored),
          // A custom color that fails WCAG AA against its own ink is flagged rather than
          // silently accepted - the whole point of Sprint E's color work is that an
          // unreadable status is a safety problem, not a taste one. Built-in keys always pass.
          outline: statusColorMeetsAA(stored) ? 'none' : '2px dashed #B3261E',
          outlineOffset: '-3px',
        }
      },
      cellEditor: ColorEditor,
      cellEditorPopup: true,
      editable: true,
      width: 300,
    }
  ]

  constructor(private log: LogService, private radioLogService: RadioLogService) {
    ensureAgGridRegistered()
  }

  /** E-73: true if any radio log entry in the current mission carries this exact status name. */
  isStatusInUse(status: string): boolean {
    return this.radioLogService.getCurrentRadioLog().logEntries
      .some(report => report.status === status)
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Angular already assigns the new value to `rowData` before this runs - this just
    // makes sure the grid redraws when the parent swaps in a new array (import / reset),
    // matching what the parent's own settings subscription does for its copy.
    //
    // F29-1: ngOnChanges fires on the FIRST binding too, before ag-Grid has mounted and
    // called onGridReady() - refreshStatusGrid() had no gridApi yet at that point, on every
    // normal page load, which is exactly the "no this.gridApi yet" log noise this was
    // fixing. onGridReady() (below) already does its own refreshStatusGrid() once the grid
    // actually exists, so the first change needs no action here - only a later reassignment
    // (import/reset) does.
    if (changes['rowData'] && !changes['rowData'].firstChange) {
      this.refreshStatusGrid()
    }
  }

  onGridReady = (params: any) => {
    this.log.verbose(" onGridReady", this.id)

    this.gridApi = params.api
    this.gridColumnApi = params.columnApi

    this.refreshStatusGrid()
  }

  onFirstDataRendered(params: any) {
    // Also called from onGridReady() above - onFirstDataRendered fires at a distinctly later
    // point (after the first real render, not just API construction) and refreshStatusGrid()
    // is idempotent, so the duplicate call is a cheap safeguard, not dead weight.
    this.refreshStatusGrid()
  }

  onBtnAddFRStatus() {
    this.rowData.push({ status: 'New Status', color: '', icon: '' })
    this.rowAdded.emit()
  }

  refreshStatusGrid() {
    if (this.gridApi) {
      this.gridApi.refreshCells()
      this.gridApi.sizeColumnsToFit();
    } else {
      this.log.verbose("no this.gridApi yet in refreshStatusGrid()", this.id)
    }
  }

  // https://angular-get-selected-rows.stackblitz.io
  getSelectedRowData() {
    let selectedNodes = this.gridApi.getSelectedNodes();
  }
}
