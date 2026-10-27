import { entriesSince } from './import-safety'

/**
 * Restore preview (E-198 phase 1, ADR D-57): the pure comparison between what is on the device
 * and what is in a backup file, shown before anything is replaced. No injection or IO.
 */

/** What one side (the device, or the file) holds, reduced to what the preview shows. */
export type RestoreSide = {
  mission: string
  /** The file's `exportedAt`; '' for the device (it is not a backup). */
  exportedAt: string
  /** The file's `appVersion`; '' for the device. */
  appVersion: string
  entries: readonly { uid?: string, date?: unknown }[]
  rangers: number
  places: number
  /** After-action notes (kind `aar`). ICS-214 lines are counted apart, below (E-04 / D-63). */
  aarNotes: number
  /** ICS-214 activity lines (kind `activity`). */
  activityLines: number
  /** Ranger photos. null = the side does not say (an older backup has no `photos`; the device's stay). */
  photos: number | null
  /** Mission journal entries (E-222). Omitted by callers that do not say; null = the file has no journal. */
  journal?: number | null
}

export type RestoreRow = { label: string, device: string, file: string }

export type RestorePreview = {
  rows: RestoreRow[]
  /** Entries on this device whose uid is not in the file: what Restore replaces and loses. */
  notInFile: number
  /** "N entries on this device are not in the file and will be replaced." */
  notInFileLine: string
  /** Set when the file was made by a newer RangerTrak than this one: a warning, never a block. */
  newerVersionWarning: string
}

/** "0.99.56-alpha" -> [0, 99, 56]. Anything unreadable gives null. */
export function parseVersion(version: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((version ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** "1.0.0-beta.2" -> ['beta', '2']; a release (no tag) gives []. Build metadata (+...) is ignored. */
function preReleaseOf(version: string): string[] {
  const m = /^v?\d+\.\d+\.\d+-([0-9A-Za-z.-]+)/.exec((version ?? '').trim())
  return m ? m[1].split('.') : []
}

/**
 * Semver order of two pre-release tags: a release (no tag) is above any pre-release of the same
 * number, numeric parts compare as numbers (beta.10 after beta.2) and below words, words compare
 * as text (alpha before beta), and a longer tag is above its own prefix. Returns <0, 0 or >0.
 */
function comparePreRelease(a: string[], b: string[]): number {
  if (!a.length || !b.length) return b.length - a.length
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const an = /^\d+$/.test(a[i]), bn = /^\d+$/.test(b[i])
    if (an && bn) {
      if (Number(a[i]) !== Number(b[i])) return Number(a[i]) - Number(b[i])
    } else if (an !== bn) {
      return an ? -1 : 1
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1
    }
  }
  return a.length - b.length
}

/**
 * True when `candidate` is a later release than `current`, in semver order: major, minor and
 * patch, then the pre-release tag (E-238: the beta runs 1.0.0-beta.1, -beta.2, ..., so a backup
 * from beta.5 restored into beta.3 is flagged; 0.99.N-alpha < 1.0.0-beta.N < 1.0.0).
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return comparePreRelease(preReleaseOf(candidate), preReleaseOf(current)) > 0
}

function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') return Date.parse(String(value)) || (typeof value === 'number' ? value : NaN)
  return NaN
}

/** The newest entry's time as epoch ms, or null when there are no readable times. */
export function newestEntryTime(entries: readonly { date?: unknown }[]): number | null {
  let newest: number | null = null
  for (const e of entries) {
    const t = timeOf(e.date)
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t
  }
  return newest
}

function pad(n: number): string { return String(n).padStart(2, '0') }

/** "2026-10-17 14:02" in the viewer's local time; '' for no time. */
export function formatLocalMinute(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The two columns of the Restore preview. `thisAppVersion` is the running app's version, for the
 * "made by a newer RangerTrak" warning.
 */
export function compareForRestore(device: RestoreSide, file: RestoreSide, thisAppVersion: string): RestorePreview {
  const lost = entriesSince(file.entries, device.entries)
  const notInFile = lost.length

  const fileIsNewer = isNewerVersion(file.appVersion, thisAppVersion)
  const rows: RestoreRow[] = [
    { label: 'Mission', device: device.mission || '(unnamed)', file: file.mission || '(unnamed)' },
    { label: 'Backed up', device: 'not a backup', file: file.exportedAt ? formatLocalMinute(Date.parse(file.exportedAt)) || file.exportedAt : 'unknown' },
    { label: 'Made by RangerTrak', device: thisAppVersion, file: fileIsNewer ? `made by a newer RangerTrak (${file.appVersion})` : (file.appVersion || 'unknown') },
    { label: 'Radio log entries', device: String(device.entries.length), file: String(file.entries.length) },
    { label: 'Newest entry', device: formatLocalMinute(newestEntryTime(device.entries)) || 'none', file: formatLocalMinute(newestEntryTime(file.entries)) || 'none' },
    { label: 'Rangers (roster)', device: String(device.rangers), file: String(file.rangers) },
    { label: 'Places', device: String(device.places), file: String(file.places) },
    { label: 'After action notes', device: String(device.aarNotes), file: String(file.aarNotes) },
    { label: 'ICS-214 log lines', device: String(device.activityLines), file: String(file.activityLines) },
    {
      label: 'Ranger photos',
      device: device.photos === null ? '?' : String(device.photos),
      file: file.photos === null ? 'not in this file (photos here stay)' : String(file.photos),
    },
  ]
  // E-222: Restore never replaces this device's journal, so the row says what the file carries.
  if (device.journal !== undefined || file.journal !== undefined) {
    rows.push({
      label: 'Journal entries',
      device: device.journal == null ? '?' : `${device.journal} (kept)`,
      file: file.journal == null ? 'none in this file' : `${file.journal} (not imported)`,
    })
  }

  const notInFileLine = notInFile === 0
    ? 'Every entry on this device is also in the file.'
    : `${plural(notInFile, 'entry', 'entries')} on this device ${notInFile === 1 ? 'is' : 'are'} not in the file and will be replaced.`

  const newerVersionWarning = fileIsNewer
    ? `This file was made by a newer RangerTrak (${file.appVersion}). It will probably restore fine, but update this device when you can.`
    : ''

  return { rows, notInFile, notInFileLine, newerVersionWarning }
}
