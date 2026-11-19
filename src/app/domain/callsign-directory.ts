/**
 * E-325: the offline call sign list. Pure parsing and filtering only (no IndexedDB, no fflate): the streaming
 * reader is `callsign-directory-import.ts` (lazy-loaded) and the storage is `CallsignDirectoryService`.
 *
 * Two public sources, both downloaded by the user, never by the app (D-10):
 * - ISED (Canada) `amateur_delim.txt`, semicolon-delimited with a header row. Read BY HEADER NAME.
 * - FCC (United States) ULS `l_amat.zip`: pipe-delimited `HD.dat` and `EN.dat`, no header row, so positions.
 *
 * Rule 5: only call sign, name, city and province/state are kept. Street address, postal/ZIP code (used by the
 * region filter, then dropped), phone and email never leave this file.
 *
 * FCC field positions (1-based, as the brief gave them; the table below is 0-based):
 *   HD.dat: 2 = unique system identifier (USI), 5 = call sign, 6 = licence status (A = active).
 *   EN.dat: 2 = USI, 5 = call sign, 6 = entity type (L = licensee; CL, CE etc. are contacts), 8 = entity name,
 *           9 = first name, 11 = last name, 17 = city, 18 = state, 19 = ZIP.
 * They match the FCC ULS public access database definitions as remembered when this was written (HD:
 * record_type, unique_system_identifier, uls_file_number, ebf_number, call_sign, license_status; EN: record_type,
 * unique_system_identifier, uls_file_number, ebf_number, call_sign, entity_type, licensee_id, entity_name,
 * first_name, mi, last_name, suffix, phone, fax, email, street_address, city, state, zip_code). The FCC page
 * could not be checked when this was written, so the positions are UNVERIFIED against the live dictionary:
 * they are kept in the one table FCC_FIELDS so a correction is a one-line change.
 */
import { normalizeCall } from './caller-kind'

export type DirectoryRow = { call: string; name: string; city: string; region: string }
export type DirectorySource = 'ised' | 'fcc'

export type DirectoryMeta = {
  source: DirectorySource
  importedAt: string
  fileName: string
  fileDate?: string
  region: string
  count: number
}

/** 0-based field positions in the FCC pipe-delimited files. */
export const FCC_FIELDS = {
  hd: { usi: 1, call: 4, status: 5 },
  en: { usi: 1, call: 4, entityType: 5, entityName: 7, first: 8, last: 10, city: 16, state: 17, zip: 18 },
} as const

// ── region filter ────────────────────────────────────────────────────────────────

export type RegionFilter = { codes: ReadonlySet<string>; prefixes: readonly string[]; all: boolean; text: string }

/**
 * "BC, WA, V9, 98070": two-letter items are province/state codes, anything else is a postal/ZIP prefix. Blank
 * means everything. Spaces inside a prefix are dropped ("V8Z 1A1" is the prefix V8Z1A1).
 */
export function parseRegionFilter(text: string): RegionFilter {
  const items = (text ?? '').split(/[,;\n]+/).map(s => s.replace(/\s+/g, '').toUpperCase()).filter(Boolean)
  const codes = new Set<string>()
  const prefixes: string[] = []
  for (const item of items) {
    if (/^[A-Z]{2}$/.test(item)) codes.add(item)
    else prefixes.push(item)
  }
  return { codes, prefixes, all: items.length === 0, text: items.join(', ') }
}

export function regionAllows(filter: RegionFilter, region: string, postal: string): boolean {
  if (filter.all) return true
  if (filter.codes.has(region.trim().toUpperCase())) return true
  const p = postal.replace(/\s+/g, '').toUpperCase()
  return !!p && filter.prefixes.some(x => p.startsWith(x))
}

// ── text ──────────────────────────────────────────────────────────────────────────

/** "JOHN SMITH" becomes "John Smith"; text that already has lower-case letters is left as it is. */
export function titleCase(text: string): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ')
  if (!s || /[a-z]/.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s\-'(])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
}

export function joinName(first: string, last: string): string {
  return titleCase([first, last].map(s => (s ?? '').trim()).filter(Boolean).join(' '))
}

/**
 * Splits a stream of decoded text into lines across chunk edges: `push` returns the complete lines, and the
 * unfinished last line is held back until the next chunk (or `end`). Handles CRLF and bare LF.
 */
export class LineSplitter {
  private tail = ''
  push(chunk: string): string[] {
    const text = this.tail + chunk
    const parts = text.split('\n')
    this.tail = parts.pop() ?? ''
    return parts.map(l => l.endsWith('\r') ? l.slice(0, -1) : l)
  }
  end(): string[] {
    const last = this.tail.endsWith('\r') ? this.tail.slice(0, -1) : this.tail
    this.tail = ''
    return last ? [last] : []
  }
}

/**
 * Decodes one entry's bytes chunk by chunk. UTF-8 first (strict); if a chunk is not valid UTF-8 the entry is
 * Windows-1252 from then on (the ISED file has been both). The earlier text was valid UTF-8, which for a
 * Latin-1 file means plain ASCII, so nothing already read is misread.
 */
export class ChunkDecoder {
  private decoder: TextDecoder = new TextDecoder('utf-8', { fatal: true })
  private latin = false
  private first = true
  decode(bytes: Uint8Array, last = false): string {
    let data = bytes
    if (this.first && data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) data = data.subarray(3)
    if (data.length) this.first = false
    if (!this.latin) {
      try {
        return this.decoder.decode(data, { stream: !last })
      } catch {
        this.latin = true
        this.decoder = new TextDecoder('windows-1252')
      }
    }
    return this.decoder.decode(data, { stream: !last })
  }
}

// ── ISED ──────────────────────────────────────────────────────────────────────────

export type IsedColumns = Record<'call' | 'first' | 'last' | 'city' | 'prov' | 'postal' | 'club' | 'club2' | 'clubCity' | 'clubProv' | 'clubPostal', number>

const ISED_ALIASES: Record<keyof IsedColumns, string[]> = {
  call: ['callsign', 'call_sign'],
  first: ['first_name', 'firstname'],
  last: ['surname', 'last_name', 'lastname'],
  city: ['city'],
  prov: ['prov_cd', 'province', 'prov'],
  postal: ['postal_code', 'postal', 'postcode'],
  club: ['club_name'],
  club2: ['club_name_2', 'club_name2'],
  clubCity: ['club_city'],
  clubProv: ['club_prov_cd', 'club_province'],
  clubPostal: ['club_postal_code'],
}

function headerKey(s: string): string {
  return s.replace(/^﻿/, '').replace(/^"|"$/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Finds the columns by header name. Null when the line does not look like the ISED header (no call sign column). */
export function parseIsedHeader(line: string): IsedColumns | null {
  const names = line.split(';').map(headerKey)
  const find = (aliases: string[]) => names.findIndex(n => aliases.includes(n))
  const cols = {} as IsedColumns
  for (const key of Object.keys(ISED_ALIASES) as (keyof IsedColumns)[]) cols[key] = find(ISED_ALIASES[key])
  return cols.call >= 0 ? cols : null
}

function cell(fields: string[], i: number): string {
  return i >= 0 && i < fields.length ? fields[i].replace(/^"|"$/g, '').trim() : ''
}

export function parseIsedRow(line: string, cols: IsedColumns, filter: RegionFilter): DirectoryRow | null {
  if (!line.trim()) return null
  const f = line.split(';')
  const call = normalizeCall(cell(f, cols.call))
  if (!call) return null
  const person = joinName(cell(f, cols.first), cell(f, cols.last))
  const club = [cell(f, cols.club), cell(f, cols.club2)].filter(Boolean).join(' ')
  const city = cell(f, cols.city) || cell(f, cols.clubCity)
  const region = (cell(f, cols.prov) || cell(f, cols.clubProv)).toUpperCase()
  const postal = cell(f, cols.postal) || cell(f, cols.clubPostal)
  if (!regionAllows(filter, region, postal)) return null
  return { call, name: person || titleCase(club), city: titleCase(city), region }
}

// ── FCC ───────────────────────────────────────────────────────────────────────────

/** HD.dat line: the unique system identifier when the licence is active (status A), else null. */
export function parseFccActiveUsi(line: string): string | null {
  const f = line.split('|')
  if ((f[FCC_FIELDS.hd.status] ?? '').trim().toUpperCase() !== 'A') return null
  const usi = (f[FCC_FIELDS.hd.usi] ?? '').trim()
  return usi || null
}

/** EN.dat line: the kept row when the licence is active, the person is the licensee, and the region filter passes. */
export function parseFccEntityRow(line: string, active: ReadonlySet<string>, filter: RegionFilter): DirectoryRow | null {
  const f = line.split('|')
  const e = FCC_FIELDS.en
  if (!active.has((f[e.usi] ?? '').trim())) return null
  const type = (f[e.entityType] ?? '').trim().toUpperCase()
  if (type && type !== 'L') return null
  const call = normalizeCall(f[e.call] ?? '')
  if (!call) return null
  const state = (f[e.state] ?? '').trim().toUpperCase()
  const zip = (f[e.zip] ?? '').trim()
  if (!regionAllows(filter, state, zip)) return null
  const person = joinName(f[e.first] ?? '', f[e.last] ?? '')
  return { call, name: person || titleCase(f[e.entityName] ?? ''), city: titleCase(f[e.city] ?? ''), region: state }
}

/** What a file name in the download is: the FCC's two files, or (anything else text) the ISED list. */
export function roleForEntry(name: string): 'fcc-status' | 'fcc-people' | 'ised' | null {
  const base = (name.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (base === 'hd.dat') return 'fcc-status'
  if (base === 'en.dat') return 'fcc-people'
  if (base.endsWith('.txt') || base.endsWith('.csv')) return 'ised'
  return null
}

export const FCC_REGION_REQUIRED = 'Pick at least one state or ZIP prefix; the whole US list is too big for a phone.'
