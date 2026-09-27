import { unzipSync, zipSync, Zippable } from 'fflate'

import { MissionType } from '../services/mission.interface'
import { MissionLocationType } from '../services/mission-location.interface'
import { RangerType } from '../services/ranger.interface'

/**
 * E-109 **Setup files**, v2 (2026-08-31, ADR D-48). A PRE-mission provisioning artifact -
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
 *
 * Photo matching reuses `RangerPhotoService`'s own filename-stem convention (a ranger's `id`
 * if set, else `callsign`, uppercased) - not reinvented here. "A wrong photo is worse than no
 * photo" (roster-build's own stated rule) - this module never guesses a match; it just
 * carries whatever `RangerPhotoService.allPhotoBlobs()` already resolved on write, and hands
 * raw filename/bytes pairs back on read for `RangerPhotoService.importFiles()`'s own matching
 * to run again against the (possibly different) roster being loaded into.
 */

export const MISSION_ZIP_SCHEMA_VERSION = 2

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
}

export type MissionZipPhoto = { filename: string; bytes: Uint8Array }

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
): Promise<Uint8Array> {
  const files: Zippable = {
    [MANIFEST_ENTRY]: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    'README.txt': new TextEncoder().encode(readmeText(manifest, photos.length)),
  }

  for (const { stem, blob } of photos) {
    files[`${PHOTOS_DIR}/${stem}${extensionFor(blob.type)}`] = new Uint8Array(await blob.arrayBuffer())
  }

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
export function extractMissionZip(bytes: Uint8Array): { manifest: MissionZipManifest; photos: MissionZipPhoto[] } {
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
  const settingsOk = !hasSettings || (typeof manifest.settings === 'object' && manifest.settings !== null)
  const rangersOk = !hasRangers || Array.isArray(manifest.rangers)
  const locationsOk = !hasLocations || Array.isArray(manifest.locations)

  if (!manifest || typeof manifest !== 'object'
    || !settingsOk || !rangersOk || !locationsOk
    || (!hasSettings && !hasRangers && !hasLocations)) {
    throw new Error(`"${MANIFEST_ENTRY}" in this zip is not a valid Setup file manifest.`)
  }

  const photos: MissionZipPhoto[] = Object.keys(entries)
    .filter(k => !/[/\\]$/.test(k) && /\.(jpe?g|png|gif|webp)$/i.test(basename(k)))
    .map(k => ({ filename: basename(k), bytes: entries[k] }))

  return { manifest, photos }
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
  if (manifest.locations) parts.push(`${manifest.locations.length} location${manifest.locations.length === 1 ? '' : 's'}`)
  if (manifest.settings) parts.push('mission settings')
  const contents = parts.length ? parts.join(', ') : 'no categories'

  return `RangerTrak Setup file\n`
    + `Built ${manifest.exportedAt.slice(0, 10)} by app v${manifest.appVersion}\n\n`
    + `mission-zip.json   ${contents}\n`
    + `photos/            ${photoCount} photograph${photoCount === 1 ? '' : 's'}\n\n`
    + `HOW TO LOAD: open RangerTrak's Setup files page (/prep) and choose this file.\n\n`
    + `CONFIDENTIAL: real names, phone numbers and photographs of volunteers.\n`
    + `Do not email it, do not put it in source control, wipe the drive after the mission.\n`
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.jpg'
}
