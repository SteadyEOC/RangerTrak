import { unzipSync, zipSync, Zippable } from 'fflate'

import { AttachmentFile, attachmentsFromUnzipped, attachmentZipEntries, isAttachmentPath } from './attachments-zip'

import { MissionType } from '../services/mission.interface'
import { MissionLocationType } from '../services/mission-location.interface'
import { RadioLogEntryType } from '../services/radio-log-entry.interface'
import { RangerType } from '../services/ranger.interface'
import { localDateTimeStamp } from './local-date'

/**
 * E-109 **Setup files**, v2 (2026-08-31, ADR D-48; v3 2026-10-15, see below). A PRE-mission provisioning artifact -
 * any combination of settings, roster, locations and photos, collapsing what otherwise takes
 * three separate imports (roster JSON, then photos, then a mission JSON) into one file a
 * coordinator hands to a scribe before a mission starts.
 *
 * **The user-facing name is "Setup file", never "Mission Zip".** The file/type/identifier
 * names in this module deliberately keep their original `missionZip` spelling - they are
 * internal, and renaming them would churn every import for no user-visible gain - but the word
 * "zip" must not appear in a button, heading or help sentence except when literally naming the
 * technical file type ("downloads a .zip file" is fine prose). Three separate features were
 * all branded around the word "zip" until 2026-08-31, which is precisely why nobody could tell
 * them apart.
 *
 * Deliberately NOT the same shape as `BackupService.MissionExport` (see the roadmap's own
 * "Mission Zip is NOT the same artifact as the existing mission export"): that one is a
 * mid/post-mission *backup* (user-facing: "Mission backup"/"Mission restore") and always
 * carries radio log entries; this one is a *template* taken before a mission has any, so it never
 * does. Two schemas, sharing only the ranger/mission types themselves - not sharing one schema
 * with a nullable `fieldReports` field, which would make "is this a backup or a template?" a
 * runtime guess instead of the file's own shape.
 *
 * **v2 (2026-08-31): every payload category is independently optional, and PRESENCE OF THE KEY
 * - not emptiness - means "this file includes this category, apply it."** An omitted key means
 * "don't touch this category at all," which is what makes a Rangers-only file, a
 * Locations-only file or a command-staff-subset file possible, and what lets several of them
 * be loaded in sequence, each merging into what the previous one left. v1 files always carried
 * `settings` + `rangers` both, so under this rule they still apply everything they always did;
 * the only behavior change for them is that rangers now MERGE rather than wholesale-replace.
 *
 * Teams is still excluded - not yet a real entity (D-a, still gated on real-world input). When
 * it ships it joins additively as `teams?`, needing no version bump of its own, exactly the way
 * `locations` did on 2026-08-31 (finishing checklist gap #1, once ADR D-49 shipped Locations as
 * the Facilities half of D-45 and the maintainer said live that a Setup file should carry them
 * - "no need to wait for Teams to include Locations"). This v1 -> v2 bump is ONLY for the
 * optional/omittable-`settings`/`rangers` semantic change, which a reader cannot infer from the
 * payload shape alone.
 *
 * The bundled `settings` deliberately travels with whatever agency-supplied keys it already
 * holds (`googleGeocodingApiKey`, `commandPostServerUrl`) rather than stripping them - decided
 * 2026-08-31: a Setup file is an explicit, operator-initiated device-provisioning action, the
 * same category D-35 already sanctions for `MissionExport`, and the whole point is a receiving
 * device that works without someone re-typing a key.
 * 2026-10-01, John: unchanged - a plain MISSION BACKUP now omits the geocoding key (it is only in
 * passphrase-protected backups), so the difference between the two is deliberate: a backup is
 * kept and passed around, a Setup file is a one-off provisioning hand-off.
 *
 * **v3 (2026-10-15, E-187 Layers, ADR D-58): an optional `layer` block** - a NAME for the file
 * (and when it was current, where it came from, what it contains, and whether it carries
 * personal information) that a reader can show: "From 'Fernhollow shelters, Oct 2026': 4 added".
 * It is a version bump, not just a new optional key, because a reader cannot tell "this file
 * has no name" from "this file predates names" by its shape, and the README now prints it.
 * Readers accept v1, v2 and v3 and nothing here rejects on the version number, so an older
 * build opens a v3 file normally and simply ignores `layer`. `sensitivity` is `pii` whenever
 * rangers are in the file (CLAUDE.md rule 5), else `none`: a places-only file needs no
 * confirm at export.
 *
 * **E-188 (2026-10-15, ADR D-59): an optional `entries` category and `layer.kind: "handover"`.**
 * A hand-over file carries the whole roster, all places and ALL radio log entries, so another
 * scribe whose device already has entries of its own can merge them in (Radio Log -> Hand over
 * to another scribe). Same rule as every category: presence of the key means "apply." The other
 * Setup-file openers (Mission's Setup file card, Rangers, Map) apply only their own part and tell the person the
 * entries merge from Radio Log. No schema bump: it is an additive key a reader can see.
 *
 * **E-194 (2026-10-16, ADR D-60): an `attachments/` folder** of `<sha256><ext>` files (stored, not
 * compressed) holding the bytes of every live attachment the sending device has, for a hand-over.
 * The entries already carry the references. NO schema bump: the folder is not in the manifest,
 * an older reader never looks inside it (and now skips it when it hunts for photos), and a newer
 * reader of an older file simply finds none. Merge in re-hashes every file (putVerified).
 *
 * Photo matching reuses `RangerPhotoService`'s own filename-stem convention (a ranger's `id`
 * if set, else `callsign`, uppercased) - not reinvented here. "A wrong photo is worse than no
 * photo" (roster-build's own stated rule) - this module never guesses a match; it just
 * carries whatever `RangerPhotoService.allPhotoBlobs()` already resolved on write, and hands
 * raw filename/bytes pairs back on read for `RangerPhotoService.importFiles()`'s own matching
 * to run again against the (possibly different) roster being loaded into.
 */

export const MISSION_ZIP_SCHEMA_VERSION = 3

/** v3: what a Setup file calls itself. See this module's header comment. */
export type MissionZipLayer = {
  name: string
  /** yyyy-mm-dd the contents were current. */
  asOf: string
  source?: string
  contains: ('people' | 'places' | 'settings' | 'entries')[]
  sensitivity: 'pii' | 'none'
  /** E-188: "handover" marks a file written by Radio Log -> Hand over to another scribe. */
  kind?: 'handover'
}

export type MissionZipManifest = {
  schemaVersion: number
  exportedAt: string
  appVersion: string
  /** v2 (2026-08-31): every category is independently optional. PRESENCE of the key - not
   *  emptiness - means "this Setup file includes this category, apply it." A v1 file always
   *  carried both `settings` and `rangers`, so it still applies everything it always did under
   *  this rule; see this module's own header comment for the full reasoning. */
  settings?: MissionType
  rangers?: RangerType[]
  /** Optional on the type for the same reason `MissionExport.locations?` is (ADR D-49): a
   *  pre-2026-08-31 Mission Zip lacks it, and extractMissionZip()'s caller defaults a missing
   *  one to `[]` rather than rejecting the zip. Always written by buildMissionZipBytes()'s own
   *  caller going forward. */
  locations?: MissionLocationType[]
  /** v3: optional. A v1/v2 file, or one written with no name, has none. */
  layer?: MissionZipLayer
  /** E-188 (D-59): every radio log entry on the sending device. Dates arrive as ISO strings
   *  (rehydrate before use). Only a hand-over file writes it. */
  entries?: RadioLogEntryType[]
  /** E-188: the sending device's mission / event / op period, ADVISORY only (a mismatch warns, never blocks). */
  context?: { mission: string, event: string, opPeriod: string }
  /** E-207 (D-62 item 6): the view this file suggests to a device that loads it. Optional and
   *  ignored by older apps; applies only while the device has no view choice of its own. Not
   *  part of the mission backup. */
  suggestedView?: 'simple' | 'full'
}

/** The `layer.contains` and `layer.sensitivity` a manifest's categories make (rangers mean personal information). */
export function layerFor(
  manifest: Pick<MissionZipManifest, 'rangers' | 'locations' | 'settings' | 'entries'>,
  name: string, asOf: string, kind?: 'handover',
): MissionZipLayer {
  const contains: MissionZipLayer['contains'] = [
    ...(manifest.rangers ? ['people' as const] : []),
    ...(manifest.locations ? ['places' as const] : []),
    ...(manifest.settings ? ['settings' as const] : []),
    ...(manifest.entries ? ['entries' as const] : []),
  ]
  // Entries can name people and describe an incident, so they count as personal information too.
  return {
    name, asOf, contains, sensitivity: manifest.rangers || manifest.entries ? 'pii' : 'none',
    ...(kind ? { kind } : {}),
  }
}

/** The name a reader should show for a file, or '' when it has none ("From 'X': ..."). */
export function layerName(manifest: Pick<MissionZipManifest, 'layer'>): string {
  const name = manifest.layer?.name
  return typeof name === 'string' ? name.trim() : ''
}

export type MissionZipPhoto = { filename: string; bytes: Uint8Array }

/** E-194: an attachment's bytes as read from a hand-over's `attachments/` folder (type is a guess from the extension). */
export type MissionZipAttachment = { sha256: string, type: string, bytes: Uint8Array }

const MANIFEST_ENTRY = 'mission-zip.json'
const PHOTOS_DIR = 'photos'

/** Basename match, not exact-path - same tolerance `importRosterBundle()` (rangers.component.ts) already needs for a hand-made Windows zip that may or may not wrap its contents in a folder. */
const basename = (path: string) => path.split(/[/\\]/).pop() || path

/**
 * Builds the zip's bytes. `photos` is whatever the caller already resolved (typically
 * `RangerPhotoService.allPhotoBlobs()`) - this function only packs it, it does not decide
 * which photos exist or match anyone.
 */
export async function buildMissionZipBytes(
  manifest: MissionZipManifest,
  photos: readonly { stem: string; blob: Blob }[],
  attachments: readonly AttachmentFile[] = [],
): Promise<Uint8Array> {
  const files: Zippable = {
    [MANIFEST_ENTRY]: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    'README.txt': new TextEncoder().encode(readmeText(manifest, photos.length)),
  }

  for (const { stem, blob } of photos) {
    files[`${PHOTOS_DIR}/${stem}${extensionFor(blob.type)}`] = new Uint8Array(await blob.arrayBuffer())
  }

  // E-194: stored at level 0 per file; the photos and manifest keep the archive's level 6.
  Object.assign(files, attachmentZipEntries(attachments))

  return zipSync(files, { level: 6 })
}

/**
 * Reverses `buildMissionZipBytes()`. Throws with a message meant to be shown to a user (same
 * convention `RangerService.parseRosterJson()` follows) rather than a bare parser error.
 * Does not validate a present `settings`/`rangers`/`locations` beyond "roughly the right
 * shape" - the caller is expected to run them through the same migration functions
 * `BackupService.importMission()` already uses (`migrateMission`/`normalizeRangerIds`) before
 * trusting them, since a Setup file built by an older app version needs exactly the same
 * upgrade path a Mission Export does.
 */
export function extractMissionZip(bytes: Uint8Array): { manifest: MissionZipManifest; photos: MissionZipPhoto[]; attachments: MissionZipAttachment[] } {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (error: any) {
    throw new Error(`Could not read this file as a zip (${error.message}).`)
  }

  const manifestKey = Object.keys(entries).find(k => basename(k) === MANIFEST_ENTRY)
  if (!manifestKey) {
    throw new Error(`This zip does not contain a "${MANIFEST_ENTRY}" - it is not a Setup file.`)
  }

  let manifest: MissionZipManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(entries[manifestKey]))
  } catch (error: any) {
    throw new Error(`"${MANIFEST_ENTRY}" in this zip is not valid JSON (${error.message}).`)
  }

  // v2: every category is independently optional, but at least ONE of settings/rangers/
  // locations must be present and correctly typed - a manifest with none of the three is
  // genuinely empty (nothing to apply), not a valid Setup file. A v1 file always has both
  // settings and rangers, so it always clears this bar the same way it always did.
  const hasSettings = manifest && typeof manifest === 'object' && manifest.settings !== undefined
  const hasRangers = manifest && typeof manifest === 'object' && manifest.rangers !== undefined
  const hasLocations = manifest && typeof manifest === 'object' && manifest.locations !== undefined
  const hasEntries = manifest && typeof manifest === 'object' && manifest.entries !== undefined
  const settingsOk = !hasSettings || (typeof manifest.settings === 'object' && manifest.settings !== null)
  const rangersOk = !hasRangers || Array.isArray(manifest.rangers)
  const locationsOk = !hasLocations || Array.isArray(manifest.locations)
  const entriesOk = !hasEntries || Array.isArray(manifest.entries)

  if (!manifest || typeof manifest !== 'object'
    || !settingsOk || !rangersOk || !locationsOk || !entriesOk
    || (!hasSettings && !hasRangers && !hasLocations && !hasEntries)) {
    throw new Error(`"${MANIFEST_ENTRY}" in this zip is not a valid Setup file manifest.`)
  }

  const photos: MissionZipPhoto[] = Object.keys(entries)
    // E-194: an attachment named <sha>.jpg is not a ranger photo.
    .filter(k => !/[/\\]$/.test(k) && !isAttachmentPath(k) && /\.(jpe?g|png|gif|webp)$/i.test(basename(k)))
    .map(k => ({ filename: basename(k), bytes: entries[k] }))

  return { manifest, photos, attachments: attachmentsFromUnzipped(entries) }
}

/**
 * A confidentiality notice inside the archive itself, same wording (adapted) and same reason
 * as `roster-build/2-make-drive-bundle.js`'s own `README.txt` - a Setup file built in-app got
 * no equivalent warning until this (finishing checklist gap #12), even though it contains the
 * same real names, phone numbers and photographs.
 *
 * v2: must not assume any category is present - a Rangers-only or Locations-only file is now
 * a normal, expected shape, not an edge case.
 */
function readmeText(manifest: MissionZipManifest, photoCount: number): string {
  const parts: string[] = []
  if (manifest.rangers) parts.push(`${manifest.rangers.length} ranger${manifest.rangers.length === 1 ? '' : 's'}`)
  if (manifest.locations) parts.push(`${manifest.locations.length} place${manifest.locations.length === 1 ? '' : 's'}`)
  if (manifest.settings) parts.push('mission settings')
  if (manifest.entries) parts.push(`${manifest.entries.length} radio log entr${manifest.entries.length === 1 ? 'y' : 'ies'}`)
  const contents = parts.length ? parts.join(', ') : 'no categories'

  const name = layerName(manifest)
  // A named file that carries no rangers is the only kind that may say "no personal information".
  const notice = manifest.rangers || manifest.entries || !manifest.layer
    ? 'CONFIDENTIAL: real names, phone numbers and photographs of volunteers'
      + (manifest.entries ? ', and the radio log of an active incident' : '') + '.\n'
      + 'Do not email it, do not put it in source control, wipe the drive after the mission.\n'
    : manifest.settings
      ? 'Mission settings can include an agency key: share this only with people who need it.\n'
      : 'Places only: this file holds no personal information.\n'

  return `RangerTrak Setup file\n`
    + (name ? `Layer: ${name}${manifest.layer?.asOf ? ` (as of ${manifest.layer.asOf})` : ''}\n` : '')
    + `Built ${manifest.exportedAt.slice(0, 10)} by app v${manifest.appVersion}\n\n`
    + `mission-zip.json   ${contents}\n`
    + `photos/            ${photoCount} photograph${photoCount === 1 ? '' : 's'}\n\n`
    + (manifest.layer?.kind === 'handover'
      ? `HOW TO LOAD: open RangerTrak's Radio Log page, choose "Hand over to another scribe", then "Merge in".\n`
      : `HOW TO LOAD: open RangerTrak's Mission page, find Setup file under Data safety, and choose this file.\n`)
    + `A list of places can also be loaded from the Map page's Import, export & print panel.\n\n`
    + notice
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.jpg'
}

/** E-188: the name of a hand-over file, like the other Setup files plus "handover" and the time. */
export function handoverFilename(mission: string, exportedAt: string, encrypted: boolean): string {
  const label = (mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
  const stamp = localDateTimeStamp(exportedAt)   // 20261015-1432, device-local
  return `rangertrak-setup-handover-${label}-${stamp}.${encrypted ? 'rtenc.json' : 'zip'}`
}

/** How many radio log entries a Setup file carries, or 0 (for the "this file also holds N" notice). */
export function entryCountOf(manifest: Pick<MissionZipManifest, 'entries'>): number {
  return Array.isArray(manifest.entries) ? manifest.entries.length : 0
}
