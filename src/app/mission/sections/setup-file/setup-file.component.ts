import { DOCUMENT } from '@angular/common'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'

import * as packageJson from '../../../../../package.json'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { describeLocationMerge, mergeLocations } from '../../../domain/location-merge'
import { migrateMission } from '../../../domain/mission-migration'
import { describeRangerMerge, mergeRangers } from '../../../domain/ranger-migration'
import { diagnoseBytes, SETUP_FILE_DAMAGED_MESSAGE } from '../../../shared/export/import-file'
import type { MissionZipManifest, MissionZipPhoto } from '../../../shared/export/mission-zip'
import { LogService, MissionLocationService, MissionService, RangerService, RangerType } from '../../../shared/services'
import { MissionJournalService } from '../../../shared/services/mission-journal.service'
import { ImportSafetyService } from '../../../shared/services/import-safety.service'
import { RangerPhotoService } from '../../../shared/services/ranger-photo.service'
import { ViewService } from '../../../shared/services/view.service'
// E-122 Phase 2a: reloadPage() awaits this before reloading - see RangersComponent.reloadPage().
import { RecordStore } from '../../../shared/storage/record-store'
import { localDateStamp } from '../../../shared/export/local-date'

/**
 * The Setup file card in Mission's Data safety card (E-187 Layers phase D, ADR D-58): the
 * whole-mission starter kit - mission settings, the roster (with photos) and the places in one
 * file, for a coordinator to hand to a scribe before a mission starts. It is what the separate
 * Setup files page (`/prep`, E-109) used to be; that route now redirects here (`/mission#setup-file`).
 *
 * **The user-facing name is "Setup file", never "Mission Zip"** (see mission-zip.ts).
 *
 * Export builds a file from whichever of settings, rangers and places are ticked. Import takes ONE
 * file at a time (the old multi-file queue was dropped: people import files one after another,
 * each with its own preview, which is clearer) and shows what it would do before anything is
 * saved: the roster and places merge into what is on the device (a blank cell never erases, and
 * nothing is removed), and settings - when the file carries them - replace this device's settings
 * wholesale, which the preview says. A Setup file never touches the radio log.
 *
 * Rangers and Map each also take a Setup file's own part through their Import card, with the
 * fuller per-person preview; this card is for applying the whole file at once.
 */
@Component({
  selector: 'rangertrak-setup-file',
  standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './setup-file.component.html',
  styleUrls: ['./setup-file.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SetupFileComponent {
  private readonly id = 'Setup file card'
  private readonly rangerService = inject(RangerService)
  private readonly missionService = inject(MissionService)
  private readonly locationService = inject(MissionLocationService)
  private readonly photos = inject(RangerPhotoService)
  private readonly log = inject(LogService)
  private readonly journal = inject(MissionJournalService)
  private readonly recordStore = inject(RecordStore)
  private readonly importSafety = inject(ImportSafetyService)
  private readonly view = inject(ViewService)
  private readonly document = inject(DOCUMENT)

  readonly building = signal(false)
  readonly applying = signal(false)

  /** Export: which categories to include. All ticked; unticking one builds a narrower file. */
  readonly exportRangers = signal(true)
  readonly exportPlaces = signal(true)
  readonly exportSettings = signal(true)
  /** E-187 (ADR D-58): an optional name for the file ("Fernhollow shelters, Oct 2026"). Blank = no layer block. */
  readonly exportLayerName = signal('')
  /** E-207 (D-62 item 6): the view this file suggests to devices that load it. '' = none (the default). */
  readonly exportSuggestedView = signal<'' | 'simple' | 'full'>('')

  /** Import: the file that was read, with what applying it would do. Null until a file is picked. */
  readonly pending = signal<PendingSetupFile | null>(null)
  /** What the last apply did, until another file is picked. */
  readonly applied = signal<string | null>(null)

  // ── Export ──────────────────────────────────────────────────────────────────────────────────

  async onBtnExport(): Promise<void> {
    const includeRangers = this.exportRangers()
    const includePlaces = this.exportPlaces()
    const includeSettings = this.exportSettings()

    if (!includeRangers && !includePlaces && !includeSettings) {
      alert('Choose at least one thing to include: settings, rangers or places.')
      return
    }
    const rangers = this.rangerService.rangers
    if (includeRangers && !rangers.length) {
      alert('There is no roster on this device to include. Untick Rangers, or add or import rangers first.')
      return
    }

    this.building.set(true)
    try {
      const { buildMissionZipBytes, layerFor, MISSION_ZIP_SCHEMA_VERSION } = await import('../../../shared/export/mission-zip')
      // No rangers in the file means no photo could possibly match anyone in it.
      const photoBlobs = includeRangers ? await this.photos.allPhotoBlobs() : []
      // JSON.parse(JSON.stringify(...)): the workaround backup.service.ts uses for a default-exporting module.
      const appVersion = JSON.parse(JSON.stringify(packageJson)).version

      const locations = includePlaces ? this.locationService.getCurrentLocations() : undefined
      const contents = {
        // D-61 item 8: the Board password travels only in an encrypted backup, never in a Setup file.
        ...(includeSettings ? { settings: { ...this.missionService.settings, boardPassword: '' } } : {}),
        ...(includeRangers ? { rangers } : {}),
        ...(includePlaces ? { locations } : {}),
      }
      const exportedAt = new Date().toISOString()
      const layer = this.exportLayerName().trim()
      const suggestedView = this.exportSuggestedView()
      const manifest: MissionZipManifest = {
        schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
        exportedAt,
        appVersion,
        ...contents,
        ...(suggestedView ? { suggestedView } : {}),
        ...(layer ? { layer: layerFor(contents, layer, exportedAt.slice(0, 10)) } : {}),
      }

      const bytes = await buildMissionZipBytes(manifest, photoBlobs)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
      // What the file holds rides along in its name, so files built from one device don't collide.
      const tag = [includeRangers && 'rangers', includePlaces && 'places', includeSettings && 'settings']
        .filter((c): c is string => !!c).join('-')
      const missionLabel = (this.missionService.settings.mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
      const filename = `rangertrak-setup-${tag}-${missionLabel}-${localDateStamp(exportedAt)}.zip`

      const a = this.document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      const parts: string[] = []
      if (includeRangers) parts.push(`${rangers.length} rangers`)
      if (includePlaces) parts.push(`${locations?.length ?? 0} places`)
      if (includeSettings) parts.push('settings')
      parts.push(`${photoBlobs.length} photos`)
      this.journal.record('setup-file-built', `Built the Setup file ${filename} (${parts.join(', ')}).`)
    } catch (e: any) {
      this.log.error(`Failed to build Setup file: ${e?.message ?? e}`, this.id)
      alert(`Could not build the Setup file.\n\n${e?.message ?? e}`)
    } finally {
      this.building.set(false)
    }
  }

  // ── Import ──────────────────────────────────────────────────────────────────────────────────

  /** Reads the picked file and shows what it would do. Nothing is saved until "Add to this device". */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so re-picking the same file still fires a change event
    if (!file) {
      return
    }
    this.applied.set(null)
    try {
      const { extractMissionZip, layerName, entryCountOf } = await import('../../../shared/export/mission-zip')
      const bytes = new Uint8Array(await file.arrayBuffer())
      // E-198: say plainly what is wrong with the file (a backup, a spreadsheet, locked, cut off...)
      // before trying to unzip it; the technical reason goes to the log only.
      const diagnosis = diagnoseBytes(bytes, 'setup-file')
      if (diagnosis.problem !== 'none') {
        this.log.error(`Could not read "${file.name}" as a Setup file: ${diagnosis.technical}`, this.id)
        alert(`Could not read "${file.name}".\n\n${diagnosis.message}`)
        return
      }
      let read: ReturnType<typeof extractMissionZip>
      try {
        read = extractMissionZip(bytes)
      } catch (zipError: any) {
        this.log.error(`Could not read "${file.name}" as a Setup file: ${zipError?.message ?? zipError}`, this.id)
        alert(`Could not read "${file.name}".\n\n${SETUP_FILE_DAMAGED_MESSAGE}`)
        return
      }
      const { manifest, photos } = read

      const lines: string[] = []
      if (manifest.settings) {
        lines.push('Mission settings: this file\'s settings replace this device\'s settings wholesale.')
      }
      if (manifest.rangers) {
        lines.push(`Rangers: ${describeRangerMerge(mergeRangers(this.rangerService.rangers, manifest.rangers))}.`)
      }
      if (manifest.locations) {
        lines.push(`${describeLocationMerge(mergeLocations(this.locationService.getCurrentLocations(), manifest.locations)).replace(/^places/, 'Places')}.`)
      }
      if (photos.length) {
        lines.push(`Photos: ${photos.length} will be stored on this device, matched to rangers by ID or call sign.`)
      }
      if (manifest.suggestedView === 'simple' || manifest.suggestedView === 'full') {
        lines.push(`View: suggests ${manifest.suggestedView === 'simple' ? 'Simple' : 'Full'} view, used only if this device has not chosen a view yet.`)
      }
      const entries = entryCountOf(manifest)
      this.pending.set({
        fileName: file.name, manifest, photos, layer: layerName(manifest), lines,
        // E-188: a hand-over file also holds radio log entries, which this card never applies.
        entriesNote: entries
          ? `This file also holds ${entries} radio log entr${entries === 1 ? 'y' : 'ies'}; merge them from Radio Log → Hand over to another scribe.`
          : '',
      })
    } catch (e: any) {
      this.log.error(`Could not read "${file.name}" as a Setup file: ${e?.message ?? e}`, this.id)
      alert(`Could not read "${file.name}".\n\n${e?.message ?? e}`)
    }
  }

  onCancelImport(): void {
    this.pending.set(null)
  }

  /**
   * Applies the file that was previewed. Rangers and places MERGE into what is already on the
   * device; settings replace wholesale. Photos already stored are not cleared first. Does not
   * reload the page by itself, so the summary survives long enough to be read ("Reload now" is
   * its own button): Rangers, Map and Entry read their data when they open.
   */
  async onApply(): Promise<void> {
    const file = this.pending()
    if (!file) {
      return
    }
    this.applying.set(true)
    try {
      // E-198: the device as it is now, kept for 24 hours, before the file is applied.
      const safetyCopy = await this.importSafety.ensureBeforeImport('setup-file', file.fileName)
      if (safetyCopy === 'cancelled') {
        this.log.verbose(`Setup file ${file.fileName}: no safety copy and the user chose not to continue.`, this.id)
        return
      }
      const summary = await this.applyFile(file)
      if (safetyCopy === 'kept') await this.importSafety.markImportDone()
      this.applied.set(`${file.fileName}: ${summary}${safetyCopy === 'kept' ? ' Undo is in Mission > Data safety for 24 hours.' : ''}`)
      // E-223: the summary names people and places; the log keeps counts only.
      this.journal.record('setup-file-applied', `Applied the Setup file ${file.fileName} (${[
        file.manifest.settings ? 'settings' : '',
        file.manifest.rangers ? `${file.manifest.rangers.length} people` : '',
        file.manifest.locations ? `${file.manifest.locations.length} places` : '',
        file.photos.length ? `${file.photos.length} photos` : '',
      ].filter(Boolean).join(', ') || 'nothing to apply'}).`)
    } catch (e: any) {
      this.log.error(`Failed to apply "${file.fileName}": ${e?.message ?? e}`, this.id)
      alert(`Could not apply "${file.fileName}".\n\n${e?.message ?? e}`)
    } finally {
      this.pending.set(null)
      this.applying.set(false)
    }
  }

  private async applyFile(file: PendingSetupFile): Promise<string> {
    const { manifest, photos } = file
    const parts: string[] = []

    if (manifest.settings) {
      const incoming = migrateMission(manifest.settings, this.missionService.initMission())
      // A Setup file carries no Board password (D-61): keep this device's.
      if (!incoming.boardPassword) incoming.boardPassword = this.missionService.settings.boardPassword
      this.missionService.updateMission(incoming)
      parts.push('settings applied')
    }

    // Photos match against the roster as it is AFTER this file's own merge (or the roster already
    // here, if the file carries none): a photo that matched the exporting device's roster is not
    // guaranteed to match after the merge.
    let rosterForPhotoMatch: RangerType[] = this.rangerService.rangers
    if (manifest.rangers) {
      const warnings = this.rangerService.rosterWarnings(manifest.rangers, this.missionService.settings?.idFieldLabel)
      warnings.forEach(w => this.log.warn(`Setup file ${file.fileName} warning: ${w}`, this.id))
      const merge = mergeRangers(this.rangerService.rangers, manifest.rangers)
      this.rangerService.replaceAllRangers(merge.rangers)
      this.rangerService.recordMergeImport(file.fileName, merge)
      rosterForPhotoMatch = merge.rangers
      parts.push(describeRangerMerge(merge))
      if (warnings.length) parts.push(`note: ${warnings.join('; ')}`)
    }

    if (manifest.locations) {
      const merge = mergeLocations(this.locationService.getCurrentLocations(), manifest.locations)
      this.locationService.replaceAllLocations(merge.locations)
      parts.push(describeLocationMerge(merge))
    }

    if (photos.length) {
      const files = photos.map(p => new File([p.bytes as BlobPart], p.filename, { type: mimeFor(p.filename) }))
      const { stored, unmatched } = await this.photos.importFiles(files, rosterForPhotoMatch)
      parts.push(`${stored.length} photo${stored.length === 1 ? '' : 's'} stored`
        + (unmatched.length ? `, ${unmatched.length} unmatched` : ''))
    }

    // E-207 / D-62 item 6: a suggestion, never an order. ViewService applies it only while this
    // device has no view choice of its own, and records it so it is applied once.
    this.view.suggest(manifest.suggestedView)

    const prefix = file.layer ? `From "${file.layer}": ` : ''
    return parts.length ? prefix + parts.join('. ') + '.' : 'carried nothing to apply.'
  }

  // A plain `window.location.reload()` is not spyable in Chrome, so tests use this wrapper
  // (same as RangersComponent.reloadPage()). Flushes the record store first (E-122 Phase 2a).
  async reloadPage(): Promise<void> {
    await this.recordStore.flush()
    window.location.reload()
  }
}

/** A Setup file that has been read and is waiting for the person to apply or cancel it. */
export type PendingSetupFile = {
  fileName: string
  manifest: MissionZipManifest
  photos: MissionZipPhoto[]
  layer: string
  /** What applying it would do, one line per category. */
  lines: string[]
  entriesNote: string
}

/** The extension-to-MIME mapping RangersComponent.mimeFor() uses. */
function mimeFor(name: string): string {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  return ext === 'png' ? 'image/png'
    : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
        : 'image/jpeg'
}
