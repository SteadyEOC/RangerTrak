import { AgGridModule } from 'ag-grid-angular'
import { ColDef, GridOptions } from 'ag-grid-community'

import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges
} from '@angular/core'

import { ensureAgGridRegistered } from '../../../shared/ag-grid-setup'
import { rangertrakGridTheme } from '../../../shared/ag-grid-theme'
import { locationMarkerSvg, resolveLocationIcon } from '../../../shared/mapping/location-marker'
import {
  LOCATION_ICON_OPTIONS, LocationCategoryType, statusColorMeetsAA, statusColorValue, statusInkValue
} from '../../../shared/services/'
import { ColorEditor } from '../../color-editor.component'

/**
 * ADR D-49: the mission-editable Location category list (Command Post, Staging Area, Ranger
 * First Aid, EOC, Fire Station, Dock, ...) - the same indirection RadioLogEntryType.status
 * already has against `radioLogStatuses`, reusing the identical grid pattern
 * (MissionFieldReportStatusesComponent) rather than inventing a second list-editor widget.
 *
 * `rowData` is the same array reference as `settings.locationTypes` (mission.component.ts's
 * `applyMissionToForm()`) - grid edits mutate it in place, so nothing needs to sync it back
 * on Save, mirroring the field-report-statuses grid exactly.
 *
 * No "renaming a category in use" lock (contrast MissionFieldReportStatusesComponent's
 * `isStatusInUse()`): field reports accumulate in bulk over a mission and status renames were
 * a reported real hazard (E-73); Locations are placed one at a time and this same protection
 * hasn't been asked for here. Add later if it turns out to matter in practice.
 *
 * Icon column (E-117, 2026-09-25): raised live 2026-08-30 as a possible follow-on, built now
 * that `LocationCategoryType.icon` exists. AG Grid's own built-in `agSelectCellEditor` -
 * no custom editor component needed, unlike Color's `ColorEditor` - lists every
 * `LocationIconId` by its human label (`LOCATION_ICON_OPTIONS`, via the `Icon` column's
 * `valueFormatter`, which `SelectCellEditor` itself consults to build the popup list) while
 * storing the bare id. `iconCellRenderer` previews the actual marker `locationMarkerSvg()`
 * draws, resolved the same way every other consumer resolves it
 * (`resolveLocationIcon()`) - a row with no `icon` set yet still shows a real marker, not a
 * blank cell.
 */
@Component({
  selector: 'rangertrak-mission-location-types',
  standalone: true,
  imports: [CommonModule, AgGridModule],
  templateUrl: './mission-location-types.component.html',
  styleUrls: ['./mission-location-types.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionLocationTypesComponent implements OnChanges {
  private id = 'Mission Location Types Component'

  @Input({ required: true }) rowData: LocationCategoryType[] = []

  private gridApi: any

  gridOptions: GridOptions = {
    theme: rangertrakGridTheme,
  }

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 30,
    editable: true,
    singleClickEdit: true,
    resizable: true,
    sortable: true,
    filter: true,
  }

  /**
   * Renders the row's ACTUAL resolved marker, not just the raw `icon` field - a row with no
   * `icon` yet (a brand-new category, or one migrated in before this field existed) still
   * shows a real pictogram via `resolveLocationIcon()`'s pin fallback, same as the map itself
   * would draw it. Plain string return (no Angular component), same pattern
   * RangersComponent's `imageCellRenderer` already uses for a preview cell.
   *
   * Declared BEFORE `columnDefs` below - both are class-field arrow functions, initialized in
   * declaration order, and `columnDefs` references `this.iconCellRenderer` at that point.
   */
  iconCellRenderer = (params: { data: LocationCategoryType }) => {
    const row = params.data
    const icon = resolveLocationIcon(row.type, [row])
    const label = LOCATION_ICON_OPTIONS.find(o => o.id === icon)?.label ?? icon
    const svg = locationMarkerSvg(icon, row.color || '#616161')
    return `<span style="display:inline-flex; align-items:center; gap:6px;">${svg}<span>${label}</span></span>`
  }

  columnDefs = [
    { headerName: "Category", field: "type", flex: 50 },
    {
      headerName: "Icon", field: "icon",
      tooltipField: "the pictogram this category's marker draws on the map",
      cellRenderer: this.iconCellRenderer,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: LOCATION_ICON_OPTIONS.map(o => o.id) },
      // Consulted by agSelectCellEditor itself (SelectCellEditor calls valueSvc.formatValue()
      // per option) to show each option's human label in the picker popup, while `type`/field
      // still stores the bare LocationIconId - same "id on disk, label in the UI" split
      // LOCATION_ICON_OPTIONS exists for.
      valueFormatter: (params: { value: string }) =>
        LOCATION_ICON_OPTIONS.find(o => o.id === params.value)?.label ?? params.value,
      editable: true,
      width: 220,
    },
    {
      headerName: "Color", field: "color",
      tooltipField: "one of the built-in accessible colors, or your own CSS color",
      cellStyle: (params: { value: string; }) => {
        this.refreshGrid()
        const stored = String(params.value ?? '')
        return {
          backgroundColor: statusColorValue(stored),
          color: statusInkValue(stored),
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

  constructor() {
    ensureAgGridRegistered()
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Same reasoning as MissionFieldReportStatusesComponent's own copy of this guard: the
    // grid redraws when the parent swaps in a new array (import/reset), not on first bind
    // (ag-Grid hasn't mounted yet at that point - onGridReady() below does its own refresh).
    if (changes['rowData'] && !changes['rowData'].firstChange) {
      this.refreshGrid()
    }
  }

  onGridReady = (params: any) => {
    this.gridApi = params.api
    this.refreshGrid()
  }

  onBtnAddLocationType() {
    this.rowData.push({ type: 'New Category', color: '' })
    this.refreshGrid()
  }

  refreshGrid() {
    if (this.gridApi) {
      this.gridApi.refreshCells()
      this.gridApi.sizeColumnsToFit()
    }
  }
}
