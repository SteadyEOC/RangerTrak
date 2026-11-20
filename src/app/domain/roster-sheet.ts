import type { RangerType } from './model/ranger.interface'
import { normalizeRangerIds } from './ranger-migration'

/**
 * Roster spreadsheets (E-187 Layers, phase A; ADR D-58): turning a table of text cells - a CSV
 * or an Excel sheet someone already keeps - into rangers, and rangers back into a table.
 *
 * Everything here is pure (ADR D-57). The input is already a `string[][]` (a header row, then
 * data rows); reading the actual file, and SheetJS with it, lives in `shared/import/`.
 *
 * Two rules from D-58 shape this file:
 * - The roster stores no addresses or e-mail addresses (CLAUDE.md rule 5: the roster is
 *   unencrypted PII on the device). Those columns map to `ignoreNotStored`, never to a field.
 * - `Status` / `Exit Date` are never mapped. A county export keeps exited members in the list;
 *   guessMapping() only REPORTS where the Status column is, and the UI offers to skip them.
 */

/** What one spreadsheet column is imported as. */
export type ColumnTarget =
  | 'id' | 'callsign' | 'fullName' | 'firstName' | 'lastName' | 'phone' | 'homePhone'
  | 'team' | 'role' | 'note' | 'uid'
  | 'ignore'
  /** An address / e-mail column: shown as "Ignored (not stored)". */
  | 'ignoreNotStored'

export const COLUMN_TARGETS: readonly ColumnTarget[] = [
  'id', 'callsign', 'fullName', 'firstName', 'lastName', 'phone', 'homePhone',
  'team', 'role', 'note', 'uid', 'ignore', 'ignoreNotStored',
]

/**
 * The words a places sheet's remembered mapping may hold (E-187 phase B). They live here, not in
 * places-file.ts, only so DevicePrefsService (which is in the initial bundle) can validate them
 * without pulling the whole places module in; places-file.ts owns what they mean.
 */
export const PLACE_TARGET_WORDS = [
  'name', 'category', 'lat', 'lng', 'wkt', 'address', 'note', 'uid', 'ignore',
] as const

export type ColumnMapping = {
  /** One target per column, in the file's column order. */
  targets: ColumnTarget[]
  /** The column holding a membership status ("Active", "Exited"), or null. Never mapped. */
  statusColumn: number | null
  /** Columns the guess did not recognise at all (they default to ignore). Empty means the
   *  whole header row was understood, so a repeat import can be one click. */
  unrecognised: number[]
}

/** Lower-case, with everything but letters and digits removed: "REW #" -> "rew", "ID (REW)" -> "idrew". */
export function normalizeHeader(header: unknown): string {
  return String(header ?? '')
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Aliases per field, already normalised. */
const ALIASES: Record<'id' | 'callsign' | 'fullName' | 'firstName' | 'lastName' | 'phone' | 'homePhone' | 'team' | 'role' | 'note' | 'uid', string[]> = {
  id: ['rangerid', 'id', 'rew', 'rewid', 'idrew', 'dsw', 'dswid', 'member', 'memberid', 'membernumber', 'badge', 'credential'],
  callsign: ['callsign', 'call', 'hamcall', 'amateurcall'],
  fullName: ['fullname', 'name', 'licensee'],
  firstName: ['firstname', 'first', 'given', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  phone: ['phone', 'cell', 'cellphone', 'mobile', 'mobilephone'],
  homePhone: ['homephone'],
  team: ['team', 'group', 'organization', 'organizationname', 'affiliation', 'agency', 'program', 'unit', 'section', 'division', 'squad'],
  role: ['role', 'position', 'assignment'],
  note: ['notes', 'note', 'comments', 'comment', 'qualifications'],
  uid: ['uid'],
}

/** Columns the app itself writes or that are known noise: understood, and not imported. */
const IGNORED_ON_THE_WAY_IN = ['lastcontact', 'image', 'photo', 'change', 'exitdate']

/** Words that mark an address / e-mail column. Tested per word, so "State" matches but "Status" does not. */
const NOT_STORED_WORDS = new Set([
  'address', 'addr', 'street', 'city', 'state', 'zip', 'zipcode', 'postal', 'email', 'mail',
])

const FIELD_ORDER = ['id', 'callsign', 'fullName', 'firstName', 'lastName', 'phone', 'homePhone', 'team', 'role', 'note', 'uid'] as const
type FieldKey = typeof FIELD_ORDER[number]

function words(header: string): string[] {
  return String(header ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Guesses what each column is. Case- and punctuation-insensitive.
 *
 * - `idFieldLabel` is the mission's own name for the ID ("REW #", "DSW"), which counts as an id alias.
 * - Where two columns want the same field, the first wins and the later one is ignored - except
 *   notes, where every note column is kept (applyMapping joins them).
 * - "First Name (REW)" beside a plain "First Name": the plain one wins, because exact names are
 *   matched before a name with a bracketed qualifier is.
 */
export function guessMapping(headers: readonly string[], idFieldLabel?: string): ColumnMapping {
  const labelAlias = normalizeHeader(idFieldLabel)
  const aliases: Record<string, string[]> = { ...ALIASES, id: labelAlias ? [...ALIASES.id, labelAlias] : ALIASES.id }

  const targets: ColumnTarget[] = headers.map(() => 'ignore')
  const decided: boolean[] = headers.map(() => false)
  const claimed = new Set<FieldKey>()
  const seenHeaders = new Set<string>()
  let statusColumn: number | null = null

  const claim = (i: number, field: FieldKey): boolean => {
    if (field !== 'note' && claimed.has(field)) {
      return false
    }
    claimed.add(field)
    targets[i] = field
    decided[i] = true
    return true
  }

  // Pass 0: blanks, repeats of an earlier header, the Status column, and known-noise columns.
  headers.forEach((h, i) => {
    const n = normalizeHeader(h)
    if (!n) {
      decided[i] = true   // an empty header cell: nothing to ask about
      return
    }
    if (seenHeaders.has(n)) {
      decided[i] = true   // duplicate header name: first one wins
      return
    }
    seenHeaders.add(n)
    if (n === 'status' && statusColumn === null) {
      statusColumn = i
      decided[i] = true
      return
    }
    if (IGNORED_ON_THE_WAY_IN.includes(n)) {
      decided[i] = true
    }
  })

  // Pass 1: exact alias match.
  headers.forEach((h, i) => {
    if (decided[i]) return
    const n = normalizeHeader(h)
    const field = FIELD_ORDER.find(f => aliases[f].includes(n))
    if (field) claim(i, field)
  })

  // Pass 2: the same, ignoring a bracketed qualifier ("Phone (cell)"), for fields still unclaimed.
  headers.forEach((h, i) => {
    if (decided[i]) return
    const stripped = normalizeHeader(String(h ?? '').replace(/\([^)]*\)/g, ''))
    if (!stripped) return
    const field = FIELD_ORDER.find(f => aliases[f].includes(stripped))
    if (field && !claimed.has(field)) claim(i, field)
  })

  // Pass 3: whatever is left that looks like an address or e-mail.
  headers.forEach((h, i) => {
    if (decided[i]) return
    if (words(h).some(w => NOT_STORED_WORDS.has(w))) {
      targets[i] = 'ignoreNotStored'
      decided[i] = true
    }
  })

  const unrecognised = headers.map((_h, i) => i).filter(i => !decided[i])
  return { targets, statusColumn, unrecognised }
}

/** A stable key for "this set of column headings", for remembering a mapping (blank headings skipped). */
export function headerSetKey(headers: readonly string[]): string {
  return headers.map(normalizeHeader).filter(Boolean).join('|')
}

export type ApplyMappingResult = {
  rangers: RangerType[]
  /** Data rows that were not turned into a ranger (no identity, or an Exited member). */
  skipped: number
  warnings: string[]
}

/** Every Status value the import's "skip" option treats as "has left". The dialog's label is built from this list. */
export const EXITED_STATUSES = ['Exited', 'Inactive', 'Retired', 'Resigned', 'Terminated', 'Former', 'Removed', 'Left'] as const

/** "Exited, Inactive, ... Removed or Left" - the statuses the skip option names. */
export function exitedStatusLabel(): string {
  const all = [...EXITED_STATUSES]
  return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`
}

// 'exit' stays a prefix match so "Exit" matches too.
const EXITED = new RegExp(`^(exit|${EXITED_STATUSES.map(s => s.toLowerCase()).join('|')})\\b`, 'i')

/**
 * Turns the data rows (everything after the header row) into rangers using a column mapping.
 *
 * Every cell is trimmed. Rows that are entirely blank are dropped without comment (the template
 * pre-formats 300 of them); a row with no id, call sign or name is dropped with a warning that
 * names its row number in the sheet. First/last name are combined only when there is no
 * full-name column; several note columns are joined with "; "; a home phone is used only when
 * there is no phone column. `uid` stays unset unless the file carries one.
 *
 * The result has been through normalizeRangerIds(), exactly as a parsed roster file is.
 */
export function applyMapping(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  opts: { skipExited?: boolean } = {},
): ApplyMappingResult {
  const cols = (target: ColumnTarget) => mapping.targets.map((t, i) => (t === target ? i : -1)).filter(i => i >= 0)
  const first = (target: ColumnTarget) => cols(target)[0] ?? -1

  const hasFullName = first('fullName') >= 0
  const hasPhone = first('phone') >= 0
  const cell = (row: readonly string[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '')

  const warnings: string[] = []
  const rangers: RangerType[] = []
  let skipped = 0

  rows.slice(1).forEach((row, n) => {
    const sheetRow = n + 2   // row 1 is the header
    if (row.every(c => String(c ?? '').trim() === '')) {
      return
    }

    if (opts.skipExited && mapping.statusColumn !== null && EXITED.test(cell(row, mapping.statusColumn))) {
      skipped++
      return
    }

    const id = cell(row, first('id'))
    const callsign = cell(row, first('callsign'))
    const fullName = hasFullName
      ? cell(row, first('fullName'))
      : [cell(row, first('firstName')), cell(row, first('lastName'))].filter(Boolean).join(' ')

    if (!id && !callsign && !fullName) {
      skipped++
      warnings.push(`Row ${sheetRow} has no ID, call sign or name, so it was skipped.`)
      return
    }

    const phone = hasPhone ? cell(row, first('phone')) : cell(row, first('homePhone'))
    const note = cols('note').map(i => cell(row, i)).filter(Boolean).join('; ')
    const uid = cell(row, first('uid'))

    rangers.push({
      uid: uid || undefined,
      id,
      callsign,
      fullName,
      phone,
      image: '',
      team: cell(row, first('team')),
      role: cell(row, first('role')),
      note,
    })
  })

  return { rangers: normalizeRangerIds(rangers).rangers, skipped, warnings }
}

// ── Remembered mappings ──────────────────────────────────────────────────────────────────────

/**
 * headerSetKey -> targets. Header NAMES only; never a cell value. Oldest entry first.
 * Places (domain/places-file.ts) share the memory under a `places:` key prefix and their own
 * targets, so the value type is plain strings and each reader validates against what it knows.
 */
export type ImportMappings = Record<string, string[]>

export const MAX_REMEMBERED_MAPPINGS = 20

/**
 * Reads the stored text defensively: anything unusable is an empty memory. `valid` lists the
 * targets an entry may hold (default: the roster's); an entry using any other word is dropped.
 */
export function parseImportMappings(raw: string | null, valid: readonly string[] = COLUMN_TARGETS): ImportMappings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ImportMappings = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every(t => typeof t === 'string' && valid.includes(t))) {
        out[key] = value as string[]
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Adds (or refreshes) a mapping, keeping at most `cap`; the oldest are dropped first. */
export function rememberMapping(
  mappings: ImportMappings, key: string, targets: readonly string[], cap = MAX_REMEMBERED_MAPPINGS,
): ImportMappings {
  if (!key) return mappings
  const { [key]: _old, ...rest } = mappings
  const entries = Object.entries({ ...rest, [key]: [...targets] })
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - cap)))
}

/** The remembered targets for these headers, if they still fit the column count. `keyPrefix` is `places:` for a places sheet. */
export function recallMapping<T extends string = ColumnTarget>(
  mappings: ImportMappings, headers: readonly string[], keyPrefix = '',
): T[] | null {
  const stored = mappings[keyPrefix + headerSetKey(headers)]
  return stored && stored.length === headers.length ? [...stored] as T[] : null
}

// ── Rows out ─────────────────────────────────────────────────────────────────────────────────

/** The grid's own heading for the id column: a blank or bare "ID" reads "Ranger ID". */
export function idColumnLabel(idFieldLabel: string | undefined): string {
  const label = (idFieldLabel ?? '').trim()
  return !label || label === 'ID' ? 'Ranger ID' : label
}

export type RosterChangeRows = {
  added: readonly RangerType[]
  edited: readonly RangerType[]
  /** uids that were imported and are gone from this device. */
  removed: readonly string[]
}

/**
 * The roster as a table: headers, then one row per ranger. The headers are the ones
 * guessMapping() recognises, so the app's own export imports again with no mapping changes.
 *
 * With `opts.changes` (Export changes) the table has a leading `change` column - added, edited
 * or removed - and only those rows. A removed ranger is just its uid: the roster no longer
 * holds anything else about them.
 */
export function rosterToRows(
  rangers: readonly RangerType[], idFieldLabel: string | undefined, opts: { changes?: RosterChangeRows } = {},
): string[][] {
  const headers = [idColumnLabel(idFieldLabel), 'Call Sign', 'Full Name', 'Phone', 'Team', 'Role', 'Notes', 'uid']
  const row = (r: Partial<RangerType>) =>
    [r.id, r.callsign, r.fullName, r.phone, r.team, r.role, r.note, r.uid].map(v => String(v ?? ''))

  if (!opts.changes) {
    return [headers, ...rangers.map(row)]
  }
  const c = opts.changes
  return [
    ['change', ...headers],
    ...c.added.map(r => ['added', ...row(r)]),
    ...c.edited.map(r => ['edited', ...row(r)]),
    ...c.removed.map(uid => ['removed', ...row({ uid })]),
  ]
}

/** Rows as CSV text: comma-separated, CRLF line ends, quotes doubled. (The caller adds any BOM.) */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map(r => r.map(quote).join(',')).join('\r\n') + '\r\n'
}
