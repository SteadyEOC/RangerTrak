import { MissionType } from '../services/mission.interface'
import { RadioLogEntryType } from '../services/radio-log-entry.interface'

/**
 * E-114 Report Packet, Phase 1 (2026-08-31, Private Roadmap.md's E-114 §2/§2a/§2b). A queued,
 * store-and-forward artifact: a device (typically a remote ranger's own phone, running in
 * "lite mode" - E-114 §1a) bundles whatever radio log entries it has filed into one small file,
 * which the main station later merges in via `RadioLogService.mergeIncomingEntries()`
 * (E-114 Phase 0) - the SAME merge function whether the packet arrives by email attachment,
 * a messaging app, a thumb drive, or read back over voice and re-typed (in which case there is
 * no packet at all - see §2a, voice is the fallback that needs nothing built).
 *
 * Plain JSON, not a zip - deliberately, unlike a Setup file. A radio log entry carries no
 * binary payload (no photos), so there is nothing zipSync() would earn its keep packing, and
 * plain JSON is also pasteable as message-body text, which a zip is not - directly relevant to
 * a carrier with no attachment path (packet radio, an SMS body). `.txt`, not `.json`, is the
 * recommended file extension for the actual export - E-114 §2b found Chromium's Web Share
 * file-sharing allowlist does not confirm `.json`, and this content already reads as plain
 * text either way.
 *
 * Deliberately excludes `rangers` (a lite device has no roster to begin with - E-114 §1a's
 * zero-provisioning design), `settings`, and `locations` - a Report Packet is reports only,
 * never a second way to move mission configuration. `mission`/`event`/`opPeriod` travel as
 * ADVISORY CONTEXT for the import warning ONLY (E-114 §3) - free text today
 * (`mission.interface.ts`), never a key, never a gate; a mismatch must warn, not block.
 */

export const REPORT_PACKET_SCHEMA_VERSION = 1

export type ReportPacket = {
  schemaVersion: number
  /** Confidentiality warning, INSIDE the file - same reasoning as mission-zip.ts's own
   *  `readmeText()`, adapted for a format with no separate README slot to hold it. */
  notice: string
  exportedAt: string
  appVersion: string
  mission: string
  event: string
  opPeriod: string
  /** Who was at the reporting device (D-44) - packet-level, not per-entry: a Report Packet
   *  is built by ONE device representing (in E-114's actual scenario) one self-reporting
   *  ranger, so this is the same credential §1a's merge design resolves against the main
   *  roster - see `RadioLogService.mergeIncomingEntries()`'s own `reporterCredential` param. */
  operator: string
  entries: RadioLogEntryType[]
}

const NOTICE = 'CONFIDENTIAL: may name real people and describe an active incident '
  + '(locations, status, notes). Do not route this file through a service you do not '
  + 'control, and delete it once its reports have been merged at the main station.'

/** Pure data assembly - kept separate from any DOM/file access so the actual contents are
 *  easy to test, same split `mission-zip.ts`'s `buildMissionZipBytes()` and
 *  `backup.service.ts`'s `buildExportPayload()` already use. */
export function buildReportPacket(params: {
  entries: readonly RadioLogEntryType[]
  settings: Pick<MissionType, 'mission' | 'event' | 'opPeriod'>
  operator: string
  appVersion: string
}): ReportPacket {
  return {
    schemaVersion: REPORT_PACKET_SCHEMA_VERSION,
    notice: NOTICE,
    exportedAt: new Date().toISOString(),
    appVersion: params.appVersion,
    mission: params.settings.mission,
    event: params.settings.event,
    opPeriod: params.settings.opPeriod,
    operator: params.operator,
    entries: [...params.entries],
  }
}

/**
 * Reverses `buildReportPacket()`. Throws with a user-facing message (same convention
 * `RangerService.parseRosterJson()`/`mission-zip.ts`'s `extractMissionZip()` follow) rather
 * than a bare parser error. Does not reject a `schemaVersion` newer than this build
 * understands - passes it through untouched, same "do not mangle data from a newer app"
 * rule every migration in this codebase already follows - but a caller should warn loudly
 * before merging one, since this build cannot know what a newer entry shape means.
 */
export function parseReportPacket(text: string): ReportPacket {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch (error: any) {
    throw new Error(`This file is not valid JSON (${error.message}).`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This file is not a valid Report Packet.')
  }
  if (typeof parsed.schemaVersion !== 'number') {
    throw new Error('This file is not a valid Report Packet (missing schemaVersion).')
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error('This file is not a valid Report Packet ("entries" is not an array).')
  }

  return parsed as ReportPacket
}

/** `.txt`, not `.json` - see this file's own header comment for why (E-114 §2b). */
export function reportPacketFilename(mission: string, exportedAt: string): string {
  const missionLabel = (mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
  return `rangertrak-report-packet-${missionLabel}-${exportedAt.slice(0, 10)}.txt`
}
