import { DOCUMENT } from '@angular/common'
import { ApplicationRef, ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'

import * as packageJson from '../../../../package.json'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatSelectModule } from '@angular/material/select'
import {
  categoryCounts, newCategoryEntries, parseGeoJsonPlaces, parseKmlPlaces, PlacesParseResult, placesToRows, selectPlaces,
  XmlDocumentLike,
} from '../../domain/places-file'
import { describeLocationMerge } from '../../domain/location-merge'
import { rowsToCsv } from '../../domain/roster-sheet'
import { IoPanelComponent } from '../../shared/io-panel/io-panel.component'
import { readSheetFile, rowsToXlsxBytes } from '../../shared/import/sheet-reader'
import { LogService, MissionLocationService, MissionService } from '../../shared/services'
import type { MissionLocationType } from '../../shared/services'
import { MissionJournalService } from '../../shared/services/mission-journal.service'
import { LOCKED_FILE_MESSAGE, readEnvelope } from '../../shared/export/handover-kind'
import { LayersCardComponent } from '../../shared/io-panel/layers-card.component'
import { LayerService } from '../../shared/services/layer.service'
import { recordableLayerName } from '../../domain/layers'
import { COORDINATE_FORMATS, type CoordinateFormat } from '../../domain/coordinate'
import { buildPlacesPrint, PlacesPrintGroup } from '../../domain/places-print'
import { PrintSheetHeadComponent } from '../../shared/print-sheet/print-sheet-head.component'
import { showFirstPrintTip } from '../../shared/export/print-tip'
import { armPrintTitle } from '../../shared/export/print-title'
import { MapEngineService } from '../map-engine.service'
import type { PlacesImportDialogResult } from '../places-import-dialog/places-import-dialog.component'
import { localDateStamp } from '../../shared/export/local-date'
import { AdvancedDirective } from '../../shared/view/advanced.directive'

type ExportFormat = 'xlsx' | 'csv' | 'setup'

/** A KML / GeoJSON / Setup file, read and ready for the preview. */
type ReadPlaces = PlacesParseResult & {
  notes?: string[]; layerName?: string
  /** E-187 phase C: what to remember the layer as; trackable is false for a hand-over, which is never a layer. */
  layerInfo?: { trackable: boolean, name: string, asOf?: string, source?: string }
}

/**
 * The Map page's "Import, export & print" panel, places half (E-187 Layers phase B, ADR D-58):
 * bring a set of places in from a spreadsheet, a Google My Maps export (KML / KMZ), a GeoJSON
 * file or a Setup file, and hand on a chosen set of places - picked by category first - as a
 * spreadsheet, a CSV or a named Setup file. Same panel and card look as Rangers.
 *
 * Page-agnostic parts live in `shared/io-panel/`; the rules (mapping, categories, merge,
 * selection) are plain functions in `domain/places-file.ts`. Nothing is saved until the user
 * presses Add to map in the preview dialog. The panel hides itself in field mode.
 */
@Component({
  selector: 'rangertrak-places-io',
  standalone: true,
  imports: [IoPanelComponent, LayersCardComponent, PrintSheetHeadComponent, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatSelectModule, AdvancedDirective],
  templateUrl: './places-io.component.html',
  styleUrls: ['./places-io.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class PlacesIoComponent {
  private readonly id = 'Map places import/export'
  private readonly dialog = inject(MatDialog)
  private readonly snackBar = inject(MatSnackBar)
  private readonly log = inject(LogService)
  private readonly journal = inject(MissionJournalService)
  private readonly locationService = inject(MissionLocationService)
  private readonly layerService = inject(LayerService)
  private readonly missionService = inject(MissionService)
  private readonly engineService = inject(MapEngineService)
  private readonly document = inject(DOCUMENT)
  private readonly appRef = inject(ApplicationRef)

  /** A fresh array each time: the service mutates its own list in place. */
  readonly places = signal<MissionLocationType[]>([])
  private readonly categoryNames = signal<string[]>([])

  readonly engine = this.engineService.engine
  readonly placingLocation = this.engineService.placingLocation

  /** Category names the user has unticked; a category that is new since is ticked by default. */
  readonly excluded = signal<ReadonlySet<string>>(new Set())
  readonly inViewOnly = signal(false)
  readonly format = signal<ExportFormat>('xlsx')
  private readonly typedLayerName = signal<string | null>(null)

  readonly counts = computed(() => categoryCounts(this.places(), this.categoryNames()))
  readonly selectedCategories = computed(() => this.counts().filter(c => !this.excluded().has(c.name)).map(c => c.name))

  /** "Only places in the current map view" needs a Leaflet map that is showing (D-56: not MapLibre). */
  readonly canUseView = computed(() => this.engine() === 'leaflet' && this.engineService.viewBounds() !== null)

  readonly chosen = computed(() => selectPlaces(this.places(), {
    categories: this.selectedCategories(),
    bounds: this.inViewOnly() && this.canUseView() ? this.engineService.viewBounds() : null,
  }))

  /** E-187 phase D: the places sheet being printed; null except while the print dialog is open. */
  readonly sheet = signal<{
    groups: PlacesPrintGroup[], count: number, printedAt: Date, withMap: boolean, scope: string,
  } | null>(null)
  readonly printPreparing = signal(false)
  /** The format the sheet writes coordinates in; the same one as the map's readout (DD, DDM or USNG). */
  readonly coordFormat = this.engineService.coordFormat
  readonly coordFormats = COORDINATE_FORMATS

  /**
   * Add place: arms the next plain click on the map (either engine) to place a Place there.
   * This panel is below the map, so arming brings the map into view to be clicked.
   */
  onToggleAddPlace(): void {
    const armed = !this.placingLocation()
    this.placingLocation.set(armed)
    if (armed) this.document.querySelector('.map-fullscreen-area')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  setCoordFormat(value: CoordinateFormat): void {
    this.engineService.chooseCoordFormat(value)
  }

  /** The name offered for a Setup file until the user types their own. */
  readonly defaultLayerName = computed(() => `${this.eventName()} places ${this.today()}`)
  readonly layerName = computed(() => this.typedLayerName() ?? this.defaultLayerName())

  constructor() {
    this.locationService.getLocationsObserver().pipe(takeUntilDestroyed())
      .subscribe(list => this.places.set([...list]))
    this.missionService.getMissionObserver().pipe(takeUntilDestroyed())
      .subscribe(m => this.categoryNames.set((m?.locationTypes ?? []).map(t => t.type)))
  }

  categoryLabel(name: string): string {
    return name || '(no category)'
  }

  isTicked(name: string): boolean {
    return !this.excluded().has(name)
  }

  setTicked(name: string, ticked: boolean): void {
    this.excluded.update(set => {
      const next = new Set(set)
      if (ticked) next.delete(name)
      else next.add(name)
      return next
    })
  }

  tickAll(): void {
    this.excluded.set(new Set())
  }

  tickNone(): void {
    this.excluded.set(new Set(this.counts().map(c => c.name)))
  }

  setLayerName(value: string): void {
    this.typedLayerName.set(value)
  }

  // ── Import ────────────────────────────────────────────────────────────────────────────────

  /** Handles a file picked via "Import places...": a spreadsheet goes through the column-mapping dialog; the rest straight to the preview. Nothing is saved until Add to map. */
  async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event
    if (!file) return

    try {
      const name = file.name.toLowerCase()
      if (/\.(csv|tsv|txt|xlsx|xls)$/.test(name)) {
        const sheet = await readSheetFile(file)
        await this.previewAndApply(file.name, { sheet })
        return
      }

      let read: ReadPlaces
      if (name.endsWith('.zip')) {
        read = await this.readSetupFile(file)
      } else if (name.endsWith('.kmz')) {
        read = await this.readKmz(file)
      } else if (name.endsWith('.kml')) {
        read = parseKmlPlaces(await file.text(), parseXml)
      } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
        const text = await file.text()
        if (readEnvelope(new TextEncoder().encode(text))) throw new Error(LOCKED_FILE_MESSAGE)
        read = parseGeoJsonPlaces(text)
      } else {
        throw new Error('RangerTrak reads places from a spreadsheet (.csv, .xlsx), Google My Maps (.kml, .kmz), GeoJSON (.geojson) or a Setup file (.zip).')
      }
      await this.previewAndApply(file.name, {
        incoming: read.places, skipped: read.skipped, warnings: read.warnings, notes: read.notes, layerName: read.layerName,
        trackable: read.layerInfo?.trackable, layerAsOf: read.layerInfo?.asOf, layerSource: read.layerInfo?.source,
      })
    } catch (error: any) {
      this.log.error(`onImportFileSelected: ${file.name} rejected: ${error.message}`, this.id)
      alert(`Could not import "${file.name}".\n\n${error.message}`)
    }
  }

  private async readKmz(file: File): Promise<ReadPlaces> {
    const { unzipSync } = await import('fflate')
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    } catch (e: any) {
      throw new Error(`Could not read this file as a KMZ (${e?.message ?? e}).`)
    }
    const base = (path: string) => path.split(/[/\\]/).pop() || path
    const key = Object.keys(entries).find(k => base(k).toLowerCase() === 'doc.kml')
      ?? Object.keys(entries).find(k => /\.kml$/i.test(k))
    if (!key) {
      throw new Error('This KMZ has no KML map data in it.')
    }
    return parseKmlPlaces(new TextDecoder().decode(entries[key]), parseXml)
  }

  /** A Setup file: its places go through the same preview; people and settings are left for the Setup file card on the Mission page. */
  private async readSetupFile(file: File): Promise<ReadPlaces> {
    const { extractMissionZip, layerName, entryCountOf } = await import('../../shared/export/mission-zip')
    const zipBytes = new Uint8Array(await file.arrayBuffer())
    if (readEnvelope(zipBytes)) throw new Error(LOCKED_FILE_MESSAGE)
    const { manifest } = extractMissionZip(zipBytes)
    if (!manifest.locations) {
      throw new Error('This Setup file does not carry any places, so there is nothing here to put on the map. '
        + 'If it carries people or settings, load it from the Setup file card on the Mission page.')
    }
    const others = [manifest.rangers && 'people', manifest.settings && 'mission settings']
      .filter((c): c is string => !!c)
    return {
      places: manifest.locations.filter(l => l && typeof l.name === 'string' && Number.isFinite(l.lat) && Number.isFinite(l.lng))
        .map(l => ({ ...l, type: l.type ?? '' })),
      skipped: 0,
      warnings: [],
      layerName: layerName(manifest) || undefined,
      layerInfo: {
        trackable: manifest.layer?.kind !== 'handover', name: recordableLayerName(manifest.layer),
        asOf: manifest.layer?.asOf, source: manifest.layer?.source,
      },
      notes: [
        ...(others.length
          ? [`This file also carries ${others.join(' and ')}. Importing places does not apply those; use the Setup file card on the Mission page for the whole file.`]
          : []),
        ...(entryCountOf(manifest)
          ? [`This file also holds ${entryCountOf(manifest)} radio log entr${entryCountOf(manifest) === 1 ? 'y' : 'ies'}; merge them from Radio Log → Hand over to another scribe.`]
          : []),
      ],
    }
  }

  private async previewAndApply(fileName: string, extra: {
    sheet?: Awaited<ReturnType<typeof readSheetFile>>
    incoming?: MissionLocationType[]
    skipped?: number
    warnings?: string[]
    notes?: string[]
    layerName?: string
    trackable?: boolean
    layerAsOf?: string
    layerSource?: string
  }): Promise<void> {
    const { PlacesImportDialogComponent } = await import('../places-import-dialog/places-import-dialog.component')
    const ref = this.dialog.open(PlacesImportDialogComponent, {
      width: '56rem',
      maxWidth: '95vw',
      data: {
        fileName,
        existing: this.locationService.getCurrentLocations(),
        existingTypes: this.missionService.settings.locationTypes.map(t => t.type),
        ...extra,
      },
    })
    const result = await new Promise<PlacesImportDialogResult | undefined>(resolve =>
      ref.afterClosed().subscribe(r => resolve(r)))
    if (!result) {
      this.log.verbose('previewAndApply: user cancelled.', this.id)
      return
    }

    const { plan } = result
    const settings = this.missionService.settings
    if (plan.newCategories.length) {
      // Categories first, so the markers the new places draw already find their colour and icon.
      const entries = newCategoryEntries(plan.newCategories, settings.locationTypes.length)
      this.missionService.updateMission({ ...settings, locationTypes: [...settings.locationTypes, ...entries] })
    }
    this.locationService.replaceAllLocations(plan.merge.locations)

    // E-187 phase C: removal the user agreed to, then remember which places this layer holds.
    let removed = 0
    if (result.removeUids.length) {
      const gone = new Set(result.removeUids)
      const all = this.locationService.getCurrentLocations()
      const kept = all.filter(l => !l.uid || !gone.has(l.uid))
      removed = all.length - kept.length
      this.locationService.replaceAllLocations(kept)
    }
    if (result.layer) {
      this.layerService.record({
        name: result.layer.name, kind: 'places', asOf: result.layer.asOf, source: result.layer.source,
        fileName, importedAt: new Date().toISOString(), uids: plan.merge.touchedUids,
      })
    }
    this.layerService.prune('places', new Set(this.locationService.getCurrentLocations().map(l => l.uid).filter((u): u is string => !!u)))

    const summary = `Imported "${fileName}"${extra.layerName ? ` (from "${extra.layerName}")` : ''}: `
      + describeLocationMerge(plan.merge)
      + (plan.newCategories.length ? `. New categories: ${plan.newCategories.join(', ')}` : '')
      + (removed ? `. Removed ${removed} no longer in "${result.layer?.name}"` : '') + '.'
    // E-223: the snackbar names the places; the log keeps counts only.
    this.journal.record('places-imported', `Imported places from "${fileName}": ${plan.merge.added.length} added, ${plan.merge.overwritten.length} updated, ${plan.merge.unchanged.length} already up to date`
      + (removed ? `, ${removed} removed` : '') + '.')
    this.snackBar.open(summary, 'OK', { duration: 20000 })
  }

  // ── Export ────────────────────────────────────────────────────────────────────────────────

  async onBtnExport(): Promise<void> {
    const places = this.chosen()
    if (!places.length) {
      alert('There are no places to export. Tick at least one category that has places in it.')
      return
    }
    const stamp = this.today()
    const partial = places.length < this.places().length ? '-selected' : ''

    try {
      if (this.format() === 'setup') {
        const name = this.layerName().trim() || this.defaultLayerName()
        const { buildMissionZipBytes, layerFor, MISSION_ZIP_SCHEMA_VERSION } = await import('../../shared/export/mission-zip')
        const exportedAt = new Date().toISOString()
        // Places only: no people, so nothing personal to confirm (D-58 item 9).
        const contents = { locations: places }
        const bytes = await buildMissionZipBytes({
          schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
          exportedAt,
          // Same JSON.parse(JSON.stringify(...)) workaround the Setup file card uses for a default-exporting module.
          appVersion: JSON.parse(JSON.stringify(packageJson)).version,
          ...contents,
          layer: layerFor(contents, name, stamp),
        }, [])
        this.downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }),
          `rangertrak-setup-places-${slug(name)}.zip`)
      } else if (this.format() === 'xlsx') {
        const bytes = await rowsToXlsxBytes(placesToRows(places), 'Places')
        this.downloadBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          `rangertrak-places-${stamp}${partial}.xlsx`)
      } else {
        this.downloadBlob(new Blob(['﻿', rowsToCsv(placesToRows(places))], { type: 'text/csv;charset=utf-8' }),
          `rangertrak-places-${stamp}${partial}.csv`)
      }
      this.journal.record('places-exported', `Exported ${places.length} places as ${this.format()}.`)
    } catch (e: any) {
      this.log.error(`Failed to export places: ${e?.message ?? e}`, this.id)
      alert(`Could not export the places.\n\n${e?.message ?? e}`)
    }
  }

  // ── Print ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Prints the chosen places as a list grouped by category (the mission's own order), with a
   * small map of them on top. The categories and "only in view" choice are Export's. The sheet is
   * a print-only block (hidden on screen, styles.scss); under Leaflet the live map is framed on
   * these places first and printed small (LeafletPrintController.preparePlacesPrint), under
   * MapLibre (D-56) the sheet is the list alone and says so. A portrait page for this print only.
   */
  async onBtnPrintPlaces(): Promise<void> {
    const places = this.chosen()
    if (!places.length || this.printPreparing()) {
      if (!places.length) {
        alert('There are no places to print. Tick at least one category that has places in it.')
      }
      return
    }
    showFirstPrintTip()
    this.printPreparing.set(true)
    let restoreMap: () => void = () => { }
    try {
      const printer = this.engine() === 'leaflet' ? this.engineService.placesPrinter() : null
      if (printer) {
        restoreMap = await printer(places)
      }
      const settings = this.missionService.settings
      this.sheet.set({
        groups: buildPlacesPrint(places, (settings?.locationTypes ?? []).map(t => t.type), this.coordFormat()),
        count: places.length,
        printedAt: new Date(),
        withMap: !!printer,
        scope: this.inViewOnly() && this.canUseView() ? 'only places in the map view' : '',
      })
      this.appRef.tick() // the sheet must be in the page before the browser lays it out

      const style = this.document.createElement('style')
      style.textContent = '@page { size: portrait; margin: 10mm 10mm 14mm 10mm;'
        + ' @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; } }'
      this.document.head.appendChild(style)
      this.document.body.classList.add('rt-print-places')
      if (!printer) {
        this.document.body.classList.add('rt-print-places-nomap')
      }
      const untitle = armPrintTitle('Places', settings)
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        this.document.body.classList.remove('rt-print-places', 'rt-print-places-nomap')
        style.remove()
        this.sheet.set(null)
        restoreMap()
        untitle()
      }
      window.addEventListener('afterprint', finish, { once: true })
      this.journal.record('print-places', `Printed ${places.length} places.`)
      const started = Date.now()
      window.print()
      // Where print() returns at once (the dialog is not modal), wait for afterprint, and as a
      // last resort the next tap or click, rather than pulling the sheet from under the preview.
      if (Date.now() - started > 500) {
        finish()
      } else {
        setTimeout(() => this.document.addEventListener('pointerdown', finish, { once: true }), 1000)
      }
    } catch (e: any) {
      restoreMap()
      this.log.error(`Failed to print places: ${e?.message ?? e}`, this.id)
      alert(`Could not print the places.\n\n${e?.message ?? e}`)
    } finally {
      this.printPreparing.set(false)
    }
  }

  private eventName(): string {
    const s = this.missionService.settings
    return (s?.event?.trim() || s?.mission?.trim() || 'RangerTrak')
  }

  private today(): string {
    return localDateStamp()
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = this.document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

/** A DOMParser wrapper that throws on malformed XML (a parse error comes back as a document, not an exception). */
function parseXml(text: string): XmlDocumentLike {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const problem = doc.getElementsByTagName('parsererror')[0]
  if (problem) {
    throw new Error((problem.textContent ?? 'malformed XML').trim().split('\n')[0])
  }
  return doc
}

/** A file-name-safe version of a layer name. */
function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'places'
}
