import { inject, Injectable, Injector, signal } from '@angular/core'
import { EncryptedFile, DecryptionFailedError, decryptBytes, encryptBytes, encryptJson, isEncryptedFile } from '../crypto/encrypted-file'
import { ATTACHMENTS_KIND, HANDOVER_KIND, HANDOVER_NOT_A_BACKUP_MESSAGE, looksLikeZip } from '../export/handover-kind'

import * as packageJson from '../../../../package.json'
import { RadioLogType } from './radio-log-entry.interface'
import { RadioLogService } from './radio-log.service'
import { LogService } from './log.service'
import { RangerService } from './ranger.service'
import { RangerType } from './ranger.interface'
import { MissionService } from './mission.service'
import { MissionType } from './mission.interface'
import { MissionLocationService } from './mission-location.service'
import { MissionLocationType } from './mission-location.interface'
import { AarNoteService } from './aar-note.service'
import { AarNoteType } from './aar-note.interface'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { RangerPhotoService } from './ranger-photo.service'
import { liveRefs } from '../../domain/attachments'
import type { AttachmentRef } from '../../domain/attachments'
import { migrateMission } from '../../domain/mission-migration'
import { normalizeRangerIds } from '../../domain/ranger-migration'
import { migrateRadioLog } from '../../domain/radio-log-migration'
import { normalizeLocationUids } from '../../domain/mission-location-migration'
import { migrateAarNotes } from '../../domain/aar-note-migration'
import { ActivityLogHeader, normalizeActivityLogHeader } from '../../domain/activity-log'
import { recordStore } from '../storage/record-store'
import { AttachmentStoreService } from './attachment-store.service'
import { MissionJournalService } from './mission-journal.service'
import { DevicePrefsService } from './device-prefs.service'
import { FieldModeService } from './field-mode.service'
import type { JournalEntry } from '../../domain/mission-journal'
import { shortHead } from '../../domain/mission-journal'
import { clearActiveDemoScenario } from '../mapping/demo-map'
import { diagnoseImportFile, stripBom } from '../../domain/import-diagnosis'
import { BACKUP_DAMAGED_MESSAGE, DIAGNOSIS_HEAD_BYTES } from '../export/import-file'
import type { LayerRecord } from '../../domain/layers'
import { localDateStamp } from '../export/local-date'

/**
 * A full mission backup: everything needed to restore the app to its
 * current state on another device/browser, or after clearing storage.
 * `radioLog.bounds` is intentionally omitted - it's derived data
 * (recalculated by RadioLogService.recalcRadioLogBounds() on every load),
 * not source-of-truth data, so there is nothing to usefully export there.
 *
 * `locations` (ADR D-49, 2026-08-30): optional on the TYPE, but always WRITTEN by
 * buildExportPayload() - "optional" here means "a pre-D-49 export file may lack it," not
 * "a caller may omit it going forward." importMission() defaults a missing one to `[]` so an
 * older export still imports cleanly rather than being rejected outright.
 *
 * `aarNotes` (E-116, 2026-09-27): the same rule. Additive and optional, so no schema bump: a
 * backup from before After Action notes restores with none.
 *
 * `activityLogHeader` (E-04 / D-63, 2026-10-20): the ICS-214 header and Resources Assigned rows. Optional, no
 * schema bump: older versions ignore it. PRESENT replaces this device's header; ABSENT leaves it alone. (ICS-214
 * lines themselves are `aarNotes` entries with `kind: 'activity'`.)
 *
 * `layers` (E-187 phase C, 2026-10-16): which layers the device holds, with the uids each brought in. The
 * same rule: PRESENT replaces this device's list, ABSENT (an older backup) leaves nothing stale - the list
 * is pruned to the roster and places just restored. No schema bump.
 *
 * `photos` (2026-10-01, John): the same rule. Ranger photos, one entry per stored photo, `data`
 * base64. PRESENT (even empty) on restore means "replace this device's photos with these";
 * ABSENT (an older backup) leaves the device's photos alone. No schema bump.
 *
 * `journal` (E-222 / D-67, 2026-10-23): a copy of this device's mission journal with its latest hash and
 * count. Additive and optional like `aarNotes`, so no schema bump. It is for the record only: Restore never
 * replaces the device's own journal; it adds one entry naming this file and the head it carried.
 *
 * `devicePrefs` (E-220 / D-68, 2026-10-23): the station letter this device logs message numbers as, so a
 * restored device carries on as the same station. Optional, no schema bump; ABSENT leaves this device's
 * letter alone. Hand-over and Setup files never carry it.
 */
export type MissionExport = {
  schemaVersion: number,
  exportedAt: string,
  appVersion: string,
  settings: MissionType,
  rangers: RangerType[],
  radioLog: Omit<RadioLogType, 'bounds'>,
  locations?: MissionLocationType[],
  aarNotes?: AarNoteType[],
  activityLogHeader?: ActivityLogHeader,
  layers?: LayerRecord[],
  photos?: { stem: string, type: string, data: string }[],
  journal?: { head: string, count: number, entries: JournalEntry[] },
  devicePrefs?: { msgStation?: string },
}

export const MISSION_EXPORT_SCHEMA_VERSION = 1

/**
 * What restoring an attachments companion did (E-194): counts, never content. `mismatched` are
 * names of files whose bytes did not match their fingerprint (shown to the operator, never
 * logged); `elsewhere` are references still without bytes on this device.
 */
export type AttachmentsRestoreResult = {
  restored: number
  alreadyHere: number
  unreferenced: number
  mismatched: string[]
  elsewhere: number
}

/**
 * Exports/imports a full mission (settings + rangers + radio log entries) as a
 * single JSON file, so a mission survives clearing browser storage and can
 * move between devices/browsers. PRIVATE-Roadmap.md Section 8/R3.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {

  private id = 'Backup Service'

  /**
   * E-122 Phase 2b: when a backup (plain OR passphrase-protected - either counts, per the
   * maintainer's 2026-09-26 answer) last finished this session, as `Date.now()`. Mission >
   * Data safety's "Enable encryption" reads this to require a backup taken within the last
   * ~10 minutes before it will proceed - enabling encryption without one risks a passphrase
   * typo destroying the only copy of the mission. Session-only and unpersisted on purpose: a
   * backup from a previous session says nothing about whether CURRENT, unsaved changes are
   * covered.
   */
  readonly lastBackupCompletedAt = signal<number | null>(null)

  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private radioLogService: RadioLogService,
    private locationService: MissionLocationService,
    private aarNoteService: AarNoteService,
    private activityLogHeaderService: ActivityLogHeaderService,
    private log: LogService,
    private photoService: RangerPhotoService,
    private journal: MissionJournalService,
  ) { }

  private injector = inject(Injector)
  private attachmentStore = inject(AttachmentStoreService)
  private devicePrefs = inject(DevicePrefsService)
  private fieldMode = inject(FieldModeService)

  /** Loaded on demand: layers are Rangers/Map-page code, kept out of the always-loaded bundle. */
  private async layerService() {
    const { LayerService } = await import('./layer.service')
    return this.injector.get(LayerService)
  }

  /** This build's version, for a backup's header and for comparing with a file's. */
  appVersion(): string {
    // Workaround for "Error: Should not import the named export ... from
    // default-exporting module" - same pattern already used in mission.service.ts.
    return JSON.parse(JSON.stringify(packageJson)).version
  }

  /**
   * Pure data assembly, no DOM/file access - kept separate from
   * exportMission() so the actual export contents are easy to test.
   *
   * 2026-10-01, John: async because photos are read from their blobs. `includeSecrets` is true
   * only for a passphrase-protected backup: the Google geocoding key and the Board password (D-61) are otherwise
   * written as '' so a plain file never carries them. (Setup files still carry it - mission-zip.ts.)
   */
  async buildExportPayload(includeSecrets = false): Promise<MissionExport> {
    const currentFieldReports = this.radioLogService.getCurrentRadioLog()
    const { bounds: _omitted, ...fieldReportsSansBounds } = currentFieldReports

    const appVersion = this.appVersion()

    return {
      schemaVersion: MISSION_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
      settings: includeSecrets
        ? this.missionService.settings
        : { ...this.missionService.settings, googleGeocodingApiKey: '', boardPassword: '' },
      rangers: this.rangerService.rangers,
      radioLog: fieldReportsSansBounds,
      locations: this.locationService.getCurrentLocations(),
      aarNotes: this.aarNoteService.getCurrentNotes(),
      activityLogHeader: this.activityLogHeaderService.getCurrentHeader(),
      layers: (await this.layerService()).snapshot(),
      photos: await this.photosForExport(),
      journal: { ...this.journal.head(), entries: this.journal.snapshot() },
      devicePrefs: { msgStation: this.devicePrefs.getMsgStation() },
    }
  }

  private async photosForExport(): Promise<NonNullable<MissionExport['photos']>> {
    const out: NonNullable<MissionExport['photos']> = []
    for (const { stem, blob } of await this.photoService.allPhotoBlobs()) {
      out.push({ stem, type: blob.type || 'image/jpeg', data: await blobToBase64(blob) })
    }
    return out
  }

  /**
   * Triggers a browser download of the current mission as a JSON file.
   */
  async exportMission(passphrase?: string): Promise<void> {
    // E-222: recorded first, so the journal copy inside the backup includes the backup itself.
    this.journal.record('backup-exported', `Exported a mission backup${passphrase ? ' (encrypted)' : ' (NOT encrypted)'}.`)
    const payload = await this.buildExportPayload(!!passphrase)

    // E-122 Phase 1: the backup carries the whole roster, so it is the file most worth
    // encrypting - and the one explicitly designed to travel between devices. Encryption
    // is opt-in per export: a passphrase nobody can recover destroys the mission record,
    // which for a life-safety tool can be worse than the exposure it prevents.
    const encrypted = !!passphrase
    const body = encrypted
      ? await encryptJson(payload, passphrase!,
        { exportedAt: payload.exportedAt, appVersion: payload.appVersion })
      : payload

    const json = JSON.stringify(body, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const missionLabel = (payload.settings.mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
    // Distinct extension so an encrypted backup is obvious in a file listing. Import does
    // not rely on it - it detects the envelope by structure - but a person sorting through
    // a folder of backups should not have to open one to find out.
    const ext = encrypted ? 'rtenc.json' : 'json'
    const filename = `rangertrak-${missionLabel}-${localDateStamp(payload.exportedAt)}.${ext}`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    this.log.verbose(`Backup file named ${filename}.`, this.id)

    // E-194 / D-60 item 6: attachment bytes never go in the JSON (references only, so every D-53
    // fixture stays valid). When any live reference has bytes here, they follow in a companion
    // zip under the same passphrase. Sequenced after the JSON, so a failure here cannot cost
    // the backup itself.
    await this.exportAttachments(payload, missionLabel, passphrase)
    this.lastBackupCompletedAt.set(Date.now())
  }

  /**
   * The backup's companion file `rangertrak-<mission>-<date>-attachments.zip` (`.rtenc.zip` when
   * encrypted): `attachments/<sha256><ext>` stored without compression, plus `attachments.json`.
   * Written only when some live reference has bytes on this device. The zip is built in memory,
   * and encrypted as one block like the backup itself, with the same passphrase.
   * Returns how many files it holds.
   */
  private async exportAttachments(payload: MissionExport, missionLabel: string, passphrase?: string): Promise<number> {
    const refs = new Map<string, AttachmentRef>()
    for (const entry of payload.radioLog.logEntries) {
      for (const ref of liveRefs(entry)) if (!refs.has(ref.sha256)) refs.set(ref.sha256, ref)
    }
    const files: { sha256: string, name: string, type: string, bytes: Uint8Array }[] = []
    for (const ref of refs.values()) {
      if (!(await this.attachmentStore.has(ref.sha256))) continue
      const blob = await this.attachmentStore.getOriginal(ref.sha256)
      files.push({ sha256: ref.sha256, name: ref.name, type: ref.type, bytes: new Uint8Array(await blob.arrayBuffer()) })
    }
    if (!files.length) return 0

    const { buildAttachmentsZipBytes } = await import('../export/attachments-zip')
    const zip = buildAttachmentsZipBytes(files, payload.exportedAt) as Uint8Array<ArrayBuffer>
    const encrypted = !!passphrase
    const body = encrypted
      ? new TextEncoder().encode(JSON.stringify(await encryptBytes(zip, passphrase!,
        { exportedAt: payload.exportedAt, appVersion: payload.appVersion, kind: ATTACHMENTS_KIND }), null, 2))
      : zip
    const filename = `rangertrak-${missionLabel}-${localDateStamp(payload.exportedAt)}-attachments.${encrypted ? 'rtenc.zip' : 'zip'}`
    const url = URL.createObjectURL(new Blob([body as BlobPart], { type: encrypted ? 'application/json' : 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.journal.record('backup-attachments-exported',
      `Exported ${files.length} attachments to a companion file${encrypted ? ' (encrypted)' : ' (NOT encrypted)'}.`)
    return files.length
  }

  /**
   * Which kind of file a Restore pick is: the backup JSON, or its attachments companion (plain zip or
   * encrypted). A zip that is not an attachments companion (a Setup file, a spreadsheet) is refused
   * here in plain words (E-198), with the right place named.
   */
  async classifyRestoreFile(file: File): Promise<'backup' | 'attachments'> {
    const head = new Uint8Array(await file.slice(0, DIAGNOSIS_HEAD_BYTES).arrayBuffer())
    if (looksLikeZip(head)) {
      const diagnosis = diagnoseImportFile(head, null, 'backup')
      if (diagnosis.detected !== 'attachments') {
        this.log.error(`Restore pick "${file.name}" is not an attachments file: ${diagnosis.technical}`, this.id)
        throw new Error(diagnosis.message)
      }
      return 'attachments'
    }
    try {
      const parsed = JSON.parse(stripBom(await file.text()))
      if (isEncryptedFile(parsed) && parsed.hint?.kind === ATTACHMENTS_KIND) return 'attachments'
    } catch { /* not JSON: readFileAsMissionExport will say what it is */ }
    return 'backup'
  }

  /**
   * Opens an attachments companion and restores the bytes for references already on this device
   * (the backup JSON first when both were picked, so its entries are in). Every file is
   * re-hashed; mismatches are listed in the result and never stored. The zip alone is fine: it
   * adds bytes for references the device already holds.
   */
  async restoreAttachmentsFile(
    file: File, getPassphrase?: (hint?: EncryptedFile['hint']) => string | null,
  ): Promise<AttachmentsRestoreResult> {
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeZip(bytes)) {
      const parsed = JSON.parse(new TextDecoder().decode(bytes))
      if (!isEncryptedFile(parsed)) throw new Error('This is not an attachments file.')
      if (!getPassphrase) throw new Error('This attachments file is encrypted, and no passphrase was supplied.')
      const passphrase = getPassphrase(parsed.hint)
      if (passphrase === null) throw new Error('Cancelled - an encrypted attachments file cannot be opened without its passphrase.')
      bytes = await decryptBytes(parsed, passphrase)
    }
    const { readAttachmentsZip } = await import('../export/attachments-zip')
    const zip = readAttachmentsZip(bytes)
    const entries = this.radioLogService.getCurrentRadioLog().logEntries
    const result = await this.attachmentStore.restoreVerified(zip.files, entries)
    return {
      restored: result.stored, alreadyHere: result.alreadyHere, unreferenced: result.unreferenced,
      mismatched: result.mismatched, elsewhere: (await this.attachmentsStatus()).elsewhere,
    }
  }

  /** Nothing restored: just how many live references have no bytes on this device ("on another device"). */
  async attachmentsStatus(): Promise<AttachmentsRestoreResult> {
    const sizes = await this.attachmentStore.sizes()
    const missing = new Set<string>()
    for (const entry of this.radioLogService.getCurrentRadioLog().logEntries) {
      for (const ref of liveRefs(entry)) if (!(ref.sha256 in sizes)) missing.add(ref.sha256)
    }
    return { restored: 0, alreadyHere: 0, unreferenced: 0, mismatched: [], elsewhere: missing.size }
  }

  /** E-222: `jrnl 3f9a·c21b (143)` for the journal a backup carries, or 'none' for one made before the journal. */
  describeBackupJournal(payload: MissionExport): string {
    return payload.journal ? shortHead(payload.journal.head, payload.journal.count) : 'none'
  }

  /** The restore line for a result, e.g. "3 attachments restored, 2 still on another device." '' when there is nothing to say. */
  describeAttachmentsRestore(r: AttachmentsRestoreResult): string {
    if (!r.restored && !r.elsewhere && !r.mismatched.length && !r.alreadyHere) return ''
    const parts = [`${r.restored} attachment${r.restored === 1 ? '' : 's'} restored`]
    if (r.elsewhere) parts.push(`${r.elsewhere} still on another device`)
    if (r.mismatched.length) {
      parts.push(`${r.mismatched.length} did not match their fingerprint and were NOT restored (${r.mismatched.join(', ')})`)
    }
    return parts.join(', ') + '.'
  }

  /**
   * Validates and applies a MissionExport, replacing current settings,
   * rangers, and radio log entries. Throws on structurally invalid input rather
   * than silently partially-applying a corrupt import.
   *
   * E-122 Phase 2a: `async` now, and the last thing this does is await `recordStore.flush()`.
   * Every caller (only `onImportFileSelected()` in mission-advanced-options.component.ts, "Restore
   * mission") reloads the page immediately after this returns - that reload used to be safe
   * with localStorage's synchronous writes, but rangers/radioLog/locations now persist to
   * IndexedDB on RecordStore's own async queue. Without this await, a reload could tear down
   * the page before that write actually committed, silently reverting the very roster this
   * import just replaced - confirmed live via e2e (checkMissionRoundTrip: "mission import
   * restores the roster after a wipe" failed intermittently until this was added). The
   * synchronous replaceAll* calls below are unchanged and still apply immediately, in memory
   * and to RecordStore's Map - only the on-disk durability guarantee is what's new here.
   */
  async importMission(payload: MissionExport): Promise<void> {
    this.validatePayload(payload)
    // E-124: a restored mission is not a demo, so its street-detail map file is evicted.
    clearActiveDemoScenario()

    // Settings first: RadioLogService.recalcRadioLogBounds() (called inside
    // replaceAllRadioLog()) requires settings to already be current, and
    // the settings->RadioLogService subscription is synchronous (both are
    // signal+ReplaySubject-backed - see mission.service.ts), so this
    // ordering is safe.
    // Migrated, not applied raw: an export can be arbitrarily old (this is the restore-after-
    // disaster path, and a mission file may sit on a thumb drive for months), and this call
    // bypasses mission.service.ts's load path entirely - so without this the import would
    // reinstate a pre-migration shape over freshly-migrated settings. See mission-migration.ts.
    const incoming = migrateMission(payload.settings, this.missionService.initMission())
    // 2026-10-01, John: a plain backup carries no geocoding key. Restoring one must not wipe
    // the key this device already has.
    if (!incoming.googleGeocodingApiKey) incoming.googleGeocodingApiKey = this.missionService.settings.googleGeocodingApiKey
    // D-61: the Board password travels the same way - only in a passphrase-protected backup.
    if (!incoming.boardPassword) incoming.boardPassword = this.missionService.settings.boardPassword
    this.missionService.updateMission(incoming)
    // Same reasoning as the settings migration above, for the same reason it is easy to
    // miss: an imported roster can predate D-42/D-43 entirely, so it may carry no uid and no
    // canonical id. Without this, importing a mission would put un-keyed rangers straight
    // into the store, bypassing RangerService's own load-path migration.
    this.rangerService.replaceAllRangers(normalizeRangerIds(payload.rangers).rangers)
    // E-220: a restored device carries on as the station the backup was made on. An older backup has
    // none and leaves this device's letter alone.
    if (payload.devicePrefs?.msgStation) this.devicePrefs.setMsgStation(payload.devicePrefs.msgStation)
    this.radioLogService.replaceAllRadioLog(
      migrateRadioLog(payload.radioLog, {
        number: !this.fieldMode.enabled(), mission: incoming.mission, opPeriod: incoming.opPeriod, station: this.devicePrefs.getMsgStation(),
      }) ?? payload.radioLog)
    // E-194 / D-60 item 8: bytes the old entries named and the restored ones do not are swept,
    // after the entries are in. Bytes a restored reference still names stay.
    await this.attachmentStore.sweepOrphans(this.radioLogService.getCurrentRadioLog().logEntries)
    // Missing on a pre-D-49 export (2026-08-30) - defaults to an empty list rather than
    // rejecting the import, same tolerance every other additive field in this app gets.
    this.locationService.replaceAllLocations(normalizeLocationUids(payload.locations ?? []))
    this.aarNoteService.replaceAllNotes(migrateAarNotes(payload.aarNotes ?? []).notes)
    // E-04 / D-63: present replaces the header, absent (an older backup) leaves this device's alone.
    if (payload.activityLogHeader) this.activityLogHeaderService.save(normalizeActivityLogHeader(payload.activityLogHeader))
    // The layers the device held (E-187 phase C). Present: put them back. Absent (an older backup):
    // keep the list but forget whatever the restored roster and places no longer contain.
    const layerService = await this.layerService()
    if (payload.layers) {
      layerService.replaceAll(payload.layers)   // LayerService.replaceAll() parses tolerantly
    }
    layerService.prune('people', new Set(this.rangerService.rangers.map(r => r.uid).filter((u): u is string => !!u)))
    layerService.prune('places', new Set(this.locationService.getCurrentLocations().map(l => l.uid).filter((u): u is string => !!u)))

    await this.restorePhotos(payload)

    // E-222: the journal entry (with the file name) is recorded by the caller; this line is only the debug trace.
    this.log.verbose(`Restore applied: export dated ${payload.exportedAt} (schema v${payload.schemaVersion}, app v${payload.appVersion}).`, this.id)

    await recordStore.flush()
  }

  /**
   * 2026-10-01, John: photos present (even empty) replace the device's; absent (older backup) leaves
   * them alone. importFiles() matches by stem against the roster just restored and encrypts when
   * device encryption is on, so nothing is duplicated here.
   * A photo failure must not stop the restore part-way: settings, roster and radio log are already
   * applied by now, and the flush is what makes them stick. Photos are the least critical part of a
   * backup, so log it and carry on.
   */
  private async restorePhotos(payload: MissionExport): Promise<void> {
    if (!payload.photos) return
    try {
      await this.photoService.clear()
      const files = payload.photos.map(p => new File([base64ToBytes(p.data)], `${p.stem}.${extFor(p.type)}`, { type: p.type }))
      await this.photoService.importFiles(files, this.rangerService.rangers)
    } catch (e: any) {
      this.log.error(`Mission restored, but its ranger photos could not be restored: ${e?.message ?? e}`, this.id)
    }
  }

  /**
   * Puts back ONLY the roster parts of a backup: rangers, the layers that name them, and ranger photos.
   * Never settings, the radio log, places or notes. Used by Undo of a roster import (E-198), so entries
   * logged since the import are never lost.
   */
  async restoreRosterParts(payload: MissionExport): Promise<void> {
    this.rangerService.replaceAllRangers(normalizeRangerIds(payload.rangers).rangers)
    const layerService = await this.layerService()
    if (payload.layers) layerService.replaceAll(payload.layers)
    layerService.prune('people', new Set(this.rangerService.rangers.map(r => r.uid).filter((u): u is string => !!u)))
    await this.restorePhotos(payload)
    await recordStore.flush()
  }

  /**
   * Reads a File (from an <input type="file"> change event) and parses it
   * as a MissionExport. Rejects with a PLAIN message (E-198, domain/import-diagnosis.ts) when the
   * file is cut off, the wrong kind, from a newer RangerTrak, damaged or not RangerTrak's at all;
   * the technical reason goes to the log only. A UTF-8 byte order mark is read away, not an error.
   */
  readFileAsMissionExport(
    file: File, getPassphrase?: (hint?: EncryptedFile['hint']) => string | null,
  ): Promise<MissionExport> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const text = reader.result as string
        try {
          let parsed: any
          try {
            parsed = JSON.parse(stripBom(text))
          } catch (parseError: any) {
            throw await this.explain(file, text, parseError.message)
          }

          // Detected structurally, not by file extension: a backup renamed on its way
          // through email still has to open, and a plain backup must still import
          // untouched (isEncryptedFile is deliberately strict about that).
          if (isEncryptedFile(parsed)) {
            // E-188: a hand-over is not a backup. Say so before asking for a passphrase.
            if (parsed.hint?.kind === HANDOVER_KIND) {
              throw new Error(HANDOVER_NOT_A_BACKUP_MESSAGE)
            }
            if (!getPassphrase) {
              throw new Error('This backup is encrypted, and no passphrase was supplied.')
            }
            const passphrase = getPassphrase(parsed.hint)
            if (passphrase === null) {
              throw new Error('Cancelled - an encrypted backup cannot be opened without its passphrase.')
            }
            const plain = await decryptBytes(parsed, passphrase)
            // A hand-over from 0.99.38 carries no kind; its decrypted payload is a zip.
            if (looksLikeZip(plain)) {
              throw new Error(HANDOVER_NOT_A_BACKUP_MESSAGE)
            }
            try {
              parsed = JSON.parse(stripBom(new TextDecoder().decode(plain)))
            } catch {
              throw new DecryptionFailedError()
            }
          } else if (parsed && typeof parsed === 'object' && typeof parsed.schemaVersion === 'number'
            && parsed.schemaVersion > MISSION_EXPORT_SCHEMA_VERSION) {
            throw await this.explain(file, text, `schemaVersion ${parsed.schemaVersion} is newer than ${MISSION_EXPORT_SCHEMA_VERSION}`)
          }

          try {
            this.validatePayload(parsed)
          } catch (structureError: any) {
            throw await this.explain(file, text, structureError.message)
          }
          resolve(parsed)
        } catch (error: any) {
          this.log.error(`Failed to parse mission import file: ${error.technical ?? error.message}`, this.id)
          reject(error)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  }

  /** The plain-words error for a file that could not be restored; `technical` is for the log only. */
  private async explain(file: File, text: string, technical: string): Promise<Error & { technical: string }> {
    const head = new Uint8Array(await file.slice(0, DIAGNOSIS_HEAD_BYTES).arrayBuffer())
    const diagnosis = diagnoseImportFile(head, text, 'backup', { backup: MISSION_EXPORT_SCHEMA_VERSION, reportPacket: 1 })
    const error = new Error(diagnosis.problem === 'none' ? BACKUP_DAMAGED_MESSAGE : diagnosis.message) as Error & { technical: string }
    error.technical = `${technical} (${diagnosis.technical})`
    return error
  }

  private validatePayload(payload: any): asserts payload is MissionExport {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Import file is not a valid mission export (not an object).')
    }
    for (const key of ['schemaVersion', 'settings', 'rangers', 'radioLog']) {
      if (!(key in payload)) {
        throw new Error(`Import file is not a valid mission export (missing "${key}").`)
      }
    }
    if (!Array.isArray(payload.rangers)) {
      throw new Error('Import file is not a valid mission export ("rangers" is not an array).')
    }
    if (!Array.isArray(payload.radioLog?.logEntries)) {
      throw new Error('Import file is not a valid mission export ("radioLog.logEntries" is not an array).')
    }
  }
}

function extFor(type: string): string {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'img'
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
