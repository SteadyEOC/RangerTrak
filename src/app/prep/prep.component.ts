import { CommonModule, DOCUMENT } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core'

import * as packageJson from '../../../package.json'
import { PageComponent } from '../shared/page/page.component'
import { MATERIAL_IMPORTS } from '../material-imports'
import {
  buildMissionZipBytes, extractMissionZip, MissionZipManifest, MissionZipPhoto,
  MISSION_ZIP_SCHEMA_VERSION,
} from '../shared/export/mission-zip'
import { migrateMission } from '../shared/services/mission-migration'
import { mergeRangers, RangerMergeResult } from '../shared/services/ranger-migration'
import { mergeLocations, LocationMergeResult } from '../shared/services/mission-location-migration'
import { LogService, MissionLocationService, MissionService, RangerService, RangerType } from '../shared/services'
import { RangerPhotoService } from '../shared/services/ranger-photo.service'
// E-122 Phase 2a: reloadPage() below awaits this before reloading - see
// RangersComponent.reloadPage()'s own doc comment for the full reasoning.
import { recordStore } from '../shared/storage/record-store'

/**
 * E-109 **Setup files**, v2 (2026-08-31, ADR D-48 - "a lazy-loaded route inside RangerTrak...
 * since others will always generate a mission"). A pre-mission provisioning tool: any
 * combination of settings, roster and locations (plus roster photos), packaged into one file a
 * coordinator hands to a scribe before a mission starts - or several such files, each carrying
 * a different slice (a Rangers-only file, a Locations-only file, a command-staff subset), all
 * loadable in one batch, each MERGING into what is already on the device rather than replacing
 * it wholesale.
 *
 * **The user-facing name is "Setup file(s)", never "Mission Zip"** - see mission-zip.ts's own
 * header comment for the full "no zip in user-facing copy" rule and why the module/route/file
 * names underneath keep their original spelling regardless.
 *
 * Deliberately its OWN route (`/prep`), not folded into Rangers' existing Import/Export roster
 * controls - those already do one clear job (roster + photos only) and this does a related but
 * distinct one (any of settings/roster/locations, no field reports, meant for a mission that
 * has not started yet). The two ARE the same style ("Setup files") and share an icon family so
 * an operator learns to associate them, but stay separate controls so neither one's own confirm
 * dialog has to describe what the other one does.
 *
 * No main-nav entry, same deliberate choice the Log page already made (E-57(1)) - this is a
 * pre-mission tool a coordinator reaches for occasionally, not a page a scribe needs mid-
 * mission. Findable from Rangers' own roster-management controls instead.
 */
@Component({
  selector: 'rangertrak-prep',
  standalone: true,
  imports: [CommonModule, PageComponent, ...MATERIAL_IMPORTS],
  templateUrl: './prep.component.html',
  styleUrls: ['./prep.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class PrepComponent {
  private id = 'Mission Prep'
  title = 'Setup files'
  pageDescr = 'Package rangers, locations and/or mission settings into files a coordinator hands to a scribe before a mission starts - or load one or more someone handed you. Each one merges into what is already on this device; nothing is replaced wholesale.'

  building = signal(false)
  applying = signal(false)

  /** Export side: which categories to include. All default checked - unchecking one is the
   *  deliberate act of building a narrower file (Rangers-only, Locations-only, ...). */
  exportRangers = signal(true)
  exportLocations = signal(true)
  exportSettings = signal(true)

  /** Import side: one or more picked-and-validated files, queued for one batch apply -
   *  replaces the old single `pending` signal (v1 only ever loaded one file at a time). */
  pendingQueue = signal<PendingSetupFile[]>([])

  /** What actually happened, one card per applied file - see R-2 (review notes): this page
   *  deliberately does NOT auto-reload after applying, specifically so this log survives long
   *  enough to be read. "Reload now" is its own explicit button underneath it. */
  sessionLog = signal<SessionLogEntry[]>([])

  constructor(
    private rangerService: RangerService,
    private missionService: MissionService,
    private locationService: MissionLocationService,
    private photos: RangerPhotoService,
    private log: LogService,
    @Inject(DOCUMENT) private document: Document,
  ) { }

  /**
   * Builds and downloads a Setup file from whichever categories are checked. Refuses to build
   * an empty file (nothing checked), and skips the "no roster on this device" guard entirely
   * when Rangers isn't even being included.
   */
  async onBtnExportSetupFiles(): Promise<void> {
    const includeRangers = this.exportRangers()
    const includeLocations = this.exportLocations()
    const includeSettings = this.exportSettings()

    if (!includeRangers && !includeLocations && !includeSettings) {
      alert('Choose at least one category to include - Rangers, Locations, or Settings.')
      return
    }

    const rangers = this.rangerService.rangers
    if (includeRangers && !rangers.length) {
      alert('There is no roster on this device to include - uncheck Rangers, or add/import rangers first.')
      return
    }

    this.building.set(true)
    try {
      // No rangers in the file means no photo could possibly match anyone in it.
      const photoBlobs = includeRangers ? await this.photos.allPhotoBlobs() : []
      // REVIEW: same JSON.parse(JSON.stringify(...)) workaround backup.service.ts and
      // mission.service.ts already use for "Should not import the named export ... from
      // default-exporting module."
      const appVersion = JSON.parse(JSON.stringify(packageJson)).version

      const locations = includeLocations ? this.locationService.getCurrentLocations() : undefined
      const manifest: MissionZipManifest = {
        schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion,
        ...(includeSettings ? { settings: this.missionService.settings } : {}),
        ...(includeRangers ? { rangers } : {}),
        ...(includeLocations ? { locations } : {}),
      }

      const bytes = await buildMissionZipBytes(manifest, photoBlobs)
      const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)

      // R-8 (review notes): the category(ies) ride along in the filename, so three files
      // built from one device don't all collide on the same name - and already group by
      // category before a coordinator even opens them, ahead of any hand-added "01-"/"02-".
      const categoryTag = [
        includeRangers && 'rangers', includeLocations && 'locations', includeSettings && 'settings',
      ].filter((c): c is string => !!c).join('-')
      const missionLabel = (this.missionService.settings.mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
      const filename = `rangertrak-setup-${categoryTag}-${missionLabel}-${manifest.exportedAt.slice(0, 10)}.zip`

      const a = this.document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      const parts: string[] = []
      if (includeRangers) parts.push(`${rangers.length} rangers`)
      if (includeLocations) parts.push(`${locations?.length ?? 0} locations`)
      if (includeSettings) parts.push('settings')
      parts.push(`${photoBlobs.length} photos`)
      this.log.info(`Built Setup file: ${filename} (${parts.join(', ')}).`, this.id)
    } catch (e: any) {
      this.log.error(`Failed to build Setup file: ${e?.message ?? e}`, this.id)
      alert(`Could not build the Setup file.\n\n${e?.message ?? e}`)
    } finally {
      this.building.set(false)
    }
  }

  /**
   * Reads and validates every picked file, queuing each one that parses. One bad file among
   * several does not block the rest (open judgment call 4) - it is reported and skipped.
   *
   * Sorted by filename before queuing, so apply order is deterministic and coordinator-
   * controlled: name files "01-rangers-teamA...", "02-locations..." to control the order they
   * merge in (last-in-wins on a matched row).
   */
  async onSetupFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    input.value = '' // so re-picking the same file(s) still fires a change event

    if (!files.length) {
      return
    }

    const queued: PendingSetupFile[] = []
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { manifest, photos } = extractMissionZip(bytes)
        queued.push({ filename: file.name, manifest, photos })
      } catch (e: any) {
        this.log.error(`Could not read "${file.name}" as a Setup file: ${e?.message ?? e}`, this.id)
        alert(`Could not read "${file.name}".\n\n${e?.message ?? e}`)
      }
    }

    if (queued.length) {
      this.pendingQueue.update(q => [...q, ...queued])
    }
  }

  onRemoveQueuedFile(filename: string): void {
    this.pendingQueue.update(q => q.filter(f => f.filename !== filename))
  }

  onClearQueue(): void {
    this.pendingQueue.set([])
  }

  /**
   * Applies every queued file, IN ORDER, after ONE confirmation for the whole batch (not one
   * dialog per file - that would defeat the point of loading several at once). Rangers and
   * Locations MERGE into whatever is already on the device (mergeRangers()/mergeLocations());
   * Settings, when a file carries it, is applied wholesale the same way Mission Restore always
   * has been. A v1 file (always carrying settings+rangers together) still applies everything
   * it always did - the only behavior change for one is that its rangers now merge rather than
   * replace, which is the safer direction (see mission-zip.ts's own header comment).
   *
   * Deliberately does NOT clear existing photos first (R-2/finishing-checklist note): v1
   * always did, because v1 was wholesale-replace; under additive semantics that would wipe
   * photos a PREVIOUS file in this same batch just stored. `RangerPhotoService.importFiles()`
   * already merges additively (IndexedDB `put()` keyed by id/callsign stem), so nothing here
   * needs to clear anything first.
   *
   * Deliberately does NOT reload the page automatically (R-2) - every other apply path in this
   * app does, but a reload here would destroy `sessionLog` the instant it is written, making
   * this feature's entire on-screen output unobservable. "Reload now" is its own button.
   */
  async onBtnApplyQueue(): Promise<void> {
    const queue = this.pendingQueue()
    if (!queue.length) {
      return
    }

    const settingsFiles = queue.filter(f => f.manifest.settings).map(f => f.filename)
    const rangersTotal = queue.reduce((n, f) => n + (f.manifest.rangers?.length ?? 0), 0)
    const locationsTotal = queue.reduce((n, f) => n + (f.manifest.locations?.length ?? 0), 0)
    const photosTotal = queue.reduce((n, f) => n + f.photos.length, 0)

    if (!confirm(
      `Apply ${queue.length} Setup file${queue.length === 1 ? '' : 's'}, in this order?\n\n`
      + queue.map((f, i) => `  ${i + 1}. ${f.filename}`).join('\n') + '\n\n'
      + `Rangers and Locations in these files MERGE into what is already on this device - a `
      + `row that matches an existing one is updated (the last file in this order wins on a `
      + `match), everything else already here is kept.\n`
      + (settingsFiles.length
        ? `Mission settings are replaced wholesale from: ${settingsFiles.join(', ')}.\n`
        : '')
      + `No photo already stored on this device is cleared first - one only changes if a `
      + `file here replaces it.\n\n`
      + `Across all files: up to ${rangersTotal} ranger row(s), ${locationsTotal} location `
      + `row(s), ${photosTotal} photo(s). There are no field reports in a Setup file, so `
      + `nothing already logged is touched.`)) {
      this.log.verbose('onBtnApplyQueue: user cancelled.', this.id)
      return
    }

    this.applying.set(true)
    const log: SessionLogEntry[] = []
    try {
      for (const file of queue) {
        try {
          const summary = await this.applyOneSetupFile(file)
          log.push({ filename: file.filename, summary })
        } catch (e: any) {
          // Skip-and-continue (open judgment call 4): one unreadable/unapplicable file must
          // not abort a batch that otherwise applies cleanly.
          this.log.error(`Failed to apply "${file.filename}": ${e?.message ?? e}`, this.id)
          log.push({ filename: file.filename, summary: `FAILED - ${e?.message ?? e}` })
        }
      }
    } finally {
      this.sessionLog.update(existing => [...existing, ...log])
      this.pendingQueue.set([])
      this.applying.set(false)
    }
  }

  /** Applies one already-validated Setup file and returns a human-readable summary of what it
   *  did, for its own sessionLog card - see onBtnApplyQueue()'s own doc comment. */
  private async applyOneSetupFile(file: PendingSetupFile): Promise<string> {
    const { manifest, photos } = file
    const parts: string[] = []

    if (manifest.settings) {
      const settings = migrateMission(manifest.settings, this.missionService.initMission())
      this.missionService.updateMission(settings)
      parts.push('settings applied')
    }

    // Photos match against whatever roster is CURRENT after this file's own ranger merge (or
    // the roster already on the device, if this file carries no rangers of its own) - a photo
    // that matched the exporting device's roster is not guaranteed to still match after merge.
    let rosterForPhotoMatch: RangerType[] = this.rangerService.rangers
    if (manifest.rangers) {
      // Checked on the INCOMING roster, before the merge - same non-fatal-problems check
      // every other roster-import path in this app runs before its own confirm(). R-8 (review
      // notes): with a queue this runs PER FILE, and belongs in that file's own summary card,
      // not one combined pre-confirm wall of text.
      const warnings = this.rangerService.rosterWarnings(manifest.rangers)
      warnings.forEach(w => this.log.warn(`Setup file import warning (${file.filename}): ${w}`, this.id))

      const merge = mergeRangers(this.rangerService.rangers, manifest.rangers)
      this.rangerService.replaceAllRangers(merge.rangers)
      rosterForPhotoMatch = merge.rangers
      parts.push(this.describeRangerMerge(merge))
      if (warnings.length) parts.push(`note: ${warnings.join('; ')}`)
    }

    if (manifest.locations) {
      const merge = mergeLocations(this.locationService.getCurrentLocations(), manifest.locations)
      this.locationService.replaceAllLocations(merge.locations)
      parts.push(this.describeLocationMerge(merge))
    }

    if (photos.length) {
      const photoFiles = photos.map(photo =>
        new File([photo.bytes as BlobPart], photo.filename, { type: this.mimeFor(photo.filename) }))
      const { stored, unmatched } = await this.photos.importFiles(photoFiles, rosterForPhotoMatch)
      parts.push(`${stored.length} photo${stored.length === 1 ? '' : 's'} stored`
        + (unmatched.length ? `, ${unmatched.length} unmatched` : ''))
    }

    return parts.length ? parts.join('. ') + '.' : 'carried no categories - nothing applied.'
  }

  /** Named adds/overwrites, never a bare count (capability, not policy: show the human what
   *  happened, let them judge it) - includes the ambiguous-match case (open judgment call 3)
   *  as its own line, not just a console warning. */
  private describeRangerMerge(merge: RangerMergeResult): string {
    const label = (r: { callsign: string; id: string }) => r.callsign || r.id || '(unidentified)'
    const bits: string[] = []
    if (merge.added.length) bits.push(`added ${merge.added.length} (${merge.added.map(label).join(', ')})`)
    if (merge.overwritten.length) bits.push(`overwrote ${merge.overwritten.length} (${merge.overwritten.map(label).join(', ')})`)
    if (merge.ambiguous.length) bits.push(`AMBIGUOUS id/callsign match, id won (${merge.ambiguous.map(label).join(', ')})`)
    return `rangers: ${bits.length ? bits.join('; ') : 'no changes'}`
  }

  private describeLocationMerge(merge: LocationMergeResult): string {
    const bits: string[] = []
    if (merge.added.length) bits.push(`added ${merge.added.length} (${merge.added.join(', ')})`)
    if (merge.overwritten.length) bits.push(`overwrote ${merge.overwritten.length} (${merge.overwritten.join(', ')})`)
    return `locations: ${bits.length ? bits.join('; ') : 'no changes'}`
  }

  // Same wrapper rangers.component.ts's own reloadPage() is, for the same reason: a plain
  // `window.location.reload()` call is not spyable in Chrome (its `reload` method is
  // non-configurable), so a real test would either throw on spyOn() or actually reload the
  // Karma page mid-suite. Naming it after the sibling component's identical method, not
  // inventing a new convention. Called from the explicit "Reload now" button only (R-2) -
  // never automatically, so `sessionLog` survives long enough to be read.
  async reloadPage(): Promise<void> {
    await recordStore.flush()
    window.location.reload()
  }

  /** Same extension-to-MIME mapping rangers.component.ts's own importRosterBundle() uses. */
  private mimeFor(name: string): string {
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
    return ext === 'png' ? 'image/png'
      : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
          : 'image/jpeg'
  }
}

/** Set once a picked file has been read and validated, before the operator applies the batch
 *  it's queued in. */
type PendingSetupFile = { filename: string; manifest: MissionZipManifest; photos: MissionZipPhoto[] }

type SessionLogEntry = { filename: string; summary: string }
