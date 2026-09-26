import { Injectable, signal } from '@angular/core'
import { EncryptedFile, decryptJson, encryptJson, isEncryptedFile } from '../crypto/encrypted-file'

import * as packageJson from '../../../../package.json'
import {
  RadioLogType, RadioLogService, LogService, RangerService, RangerType, MissionService,
  MissionType, MissionLocationService, MissionLocationType
} from './'
import { migrateMission } from './mission-migration'
import { normalizeRangerIds } from './ranger-migration'
import { migrateRadioLog } from './radio-log-migration'
import { normalizeLocationUids } from './mission-location-migration'
import { recordStore } from '../storage/record-store'

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
 */
export type MissionExport = {
  schemaVersion: number,
  exportedAt: string,
  appVersion: string,
  settings: MissionType,
  rangers: RangerType[],
  radioLog: Omit<RadioLogType, 'bounds'>,
  locations?: MissionLocationType[],
}

export const MISSION_EXPORT_SCHEMA_VERSION = 1

/**
 * Exports/imports a full mission (settings + rangers + field reports) as a
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
    private log: LogService,
  ) { }

  /**
   * Pure data assembly, no DOM/file access - kept separate from
   * exportMission() so the actual export contents are easy to test.
   */
  buildExportPayload(): MissionExport {
    const currentFieldReports = this.radioLogService.getCurrentRadioLog()
    const { bounds: _omitted, ...fieldReportsSansBounds } = currentFieldReports

    // REVIEW: Workaround for "Error: Should not import the named export ... from
    // default-exporting module" - same pattern already used in mission.service.ts.
    const appVersion = JSON.parse(JSON.stringify(packageJson)).version

    return {
      schemaVersion: MISSION_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
      settings: this.missionService.settings,
      rangers: this.rangerService.rangers,
      radioLog: fieldReportsSansBounds,
      locations: this.locationService.getCurrentLocations(),
    }
  }

  /**
   * Triggers a browser download of the current mission as a JSON file.
   */
  async exportMission(passphrase?: string): Promise<void> {
    const payload = this.buildExportPayload()

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
    const filename = `rangertrak-${missionLabel}-${payload.exportedAt.slice(0, 10)}.${ext}`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    this.log.info(`Exported mission to ${filename}`
      + `${encrypted ? ' (encrypted)' : ' (NOT encrypted)'}`, this.id)
    this.lastBackupCompletedAt.set(Date.now())
  }

  /**
   * Validates and applies a MissionExport, replacing current settings,
   * rangers, and field reports. Throws on structurally invalid input rather
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

    // Settings first: RadioLogService.recalcRadioLogBounds() (called inside
    // replaceAllRadioLog()) requires settings to already be current, and
    // the settings->RadioLogService subscription is synchronous (both are
    // signal+ReplaySubject-backed - see mission.service.ts), so this
    // ordering is safe.
    // Migrated, not applied raw: an export can be arbitrarily old (this is the restore-after-
    // disaster path, and a mission file may sit on a thumb drive for months), and this call
    // bypasses mission.service.ts's load path entirely - so without this the import would
    // reinstate a pre-migration shape over freshly-migrated settings. See mission-migration.ts.
    this.missionService.updateMission(migrateMission(payload.settings, this.missionService.initMission()))
    // Same reasoning as the settings migration above, for the same reason it is easy to
    // miss: an imported roster can predate D-42/D-43 entirely, so it may carry no uid and no
    // canonical id. Without this, importing a mission would put un-keyed rangers straight
    // into the store, bypassing RangerService's own load-path migration.
    this.rangerService.replaceAllRangers(normalizeRangerIds(payload.rangers).rangers)
    this.radioLogService.replaceAllRadioLog(
      migrateRadioLog(payload.radioLog) ?? payload.radioLog)
    // Missing on a pre-D-49 export (2026-08-30) - defaults to an empty list rather than
    // rejecting the import, same tolerance every other additive field in this app gets.
    this.locationService.replaceAllLocations(normalizeLocationUids(payload.locations ?? []))

    this.log.warn(`Imported mission from export dated ${payload.exportedAt} (schema v${payload.schemaVersion}, app v${payload.appVersion})`, this.id)

    await recordStore.flush()
  }

  /**
   * Reads a File (from an <input type="file"> change event) and parses it
   * as a MissionExport. Rejects on invalid JSON or an invalid shape.
   */
  readFileAsMissionExport(
    file: File, getPassphrase?: (hint?: EncryptedFile['hint']) => string | null,
  ): Promise<MissionExport> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          let parsed = JSON.parse(reader.result as string)

          // Detected structurally, not by file extension: a backup renamed on its way
          // through email still has to open, and a plain backup must still import
          // untouched (isEncryptedFile is deliberately strict about that).
          if (isEncryptedFile(parsed)) {
            if (!getPassphrase) {
              throw new Error('This backup is encrypted, and no passphrase was supplied.')
            }
            const passphrase = getPassphrase(parsed.hint)
            if (passphrase === null) {
              throw new Error('Cancelled - an encrypted backup cannot be opened without its passphrase.')
            }
            parsed = await decryptJson(parsed, passphrase)
          }

          this.validatePayload(parsed)
          resolve(parsed)
        } catch (error: any) {
          this.log.error(`Failed to parse mission import file: ${error.message}`, this.id)
          reject(error)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
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
