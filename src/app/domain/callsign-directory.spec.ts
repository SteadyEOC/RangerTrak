// Made-up rows only: no real person or call sign appears in this file.
// FCC field positions: see the header comment of callsign-directory.ts (unverified against the live FCC dictionary).
import { zipSync, strToU8 } from 'fflate'
import {
  ChunkDecoder, LineSplitter, parseFccActiveUsi, parseFccEntityRow, parseIsedHeader, parseIsedRow,
  parseRegionFilter, regionAllows, titleCase, roleForEntry,
} from './callsign-directory'
import { importDirectoryFile, streamLines, DirectoryImportError } from './callsign-directory-import'
import type { DirectoryRow } from './callsign-directory'

describe('region filter', () => {
  it('blank means everything', () => {
    expect(parseRegionFilter('  ').all).toBe(true)
    expect(regionAllows(parseRegionFilter(''), 'XX', '')).toBe(true)
  })
  it('two letters are codes, anything else a prefix', () => {
    const f = parseRegionFilter('bc, wa, V8Z, 980')
    expect([...f.codes].sort()).toEqual(['BC', 'WA'])
    expect(f.prefixes).toEqual(['V8Z', '980'])
    expect(regionAllows(f, 'BC', '')).toBe(true)
    expect(regionAllows(f, 'OR', '98070-1234')).toBe(true)
    expect(regionAllows(f, 'ON', 'V8Z 1A1')).toBe(true)
    expect(regionAllows(f, 'OR', '97201')).toBe(false)
    expect(regionAllows(f, '', '')).toBe(false)
  })
})

describe('titleCase', () => {
  it('title-cases upper-case text and leaves mixed case', () => {
    expect(titleCase('ANNA-MARIE O\'NEIL')).toBe('Anna-Marie O\'Neil')
    expect(titleCase('Example Radio Club')).toBe('Example Radio Club')
  })
})

describe('LineSplitter', () => {
  it('joins a line split across chunks and handles CRLF', () => {
    const s = new LineSplitter()
    expect(s.push('one\r\ntw')).toEqual(['one'])
    expect(s.push('o\nthr')).toEqual(['two'])
    expect(s.push('ee')).toEqual([])
    expect(s.end()).toEqual(['three'])
  })
})

describe('ChunkDecoder', () => {
  it('reads UTF-8 and strips a BOM', () => {
    const d = new ChunkDecoder()
    expect(d.decode(new Uint8Array([0xEF, 0xBB, 0xBF, ...strToU8('Café')]))).toBe('Café')
  })
  it('falls back to Windows-1252 on bytes that are not UTF-8', () => {
    const d = new ChunkDecoder()
    expect(d.decode(new Uint8Array([0x4D, 0x75, 0x6C, 0x6C, 0xE9, 0x72]))).toBe('Mullér')
  })
  it('keeps a multi-byte character split across chunks', () => {
    const bytes = strToU8('é')   // 2 bytes
    const d = new ChunkDecoder()
    expect(d.decode(bytes.subarray(0, 1)) + d.decode(bytes.subarray(1))).toBe('é')
  })
})

const ISED_HEADER = 'callsign;first_name;surname;address_line;city;prov_cd;postal_code;qual_a;club_name;club_name_2;club_address;club_city;club_prov_cd;club_postal_code;'
const ISED_ROWS = [
  'VE7AAA;PAT;EXAMPLE;1 NOWHERE RD;VICTORIA;BC;V8Z1A1;A;;;;;;;',
  'VA7BBB;SAM;SAMPLE;2 NOWHERE RD;TORONTO;ON;M5V2T6;A;;;;;;;',
  'VE7CCC;;;;;;;A;EXAMPLE RADIO CLUB;;3 CLUB LANE;SAANICH;BC;V8X0A0;',
  'VE7DDD;PAT;TESTER;4 NOWHERE RD;VICTORIA;BC;V8Z1A2;A;;;;;;;',
]

describe('ISED parsing', () => {
  it('finds columns by header name, in any order, with a BOM and spaces', () => {
    const cols = parseIsedHeader('﻿Surname;City;Call Sign;Prov_Cd;First Name;Postal Code')
    expect(cols).not.toBeNull()
    expect(cols!.call).toBe(2)
    expect(cols!.last).toBe(0)
    expect(cols!.prov).toBe(3)
    expect(cols!.club).toBe(-1)
  })
  it('is not a header without a call sign column', () => {
    expect(parseIsedHeader('a;b;c')).toBeNull()
  })
  it('keeps call, name, city and province only', () => {
    const cols = parseIsedHeader(ISED_HEADER)!
    const row = parseIsedRow(ISED_ROWS[0], cols, parseRegionFilter(''))
    expect(row).toEqual({ call: 'VE7AAA', name: 'Pat Example', city: 'Victoria', region: 'BC' })
    expect(JSON.stringify(row)).not.toContain('NOWHERE')
    expect(JSON.stringify(row)).not.toContain('V8Z')
  })
  it('uses the club name when there is no person', () => {
    const cols = parseIsedHeader(ISED_HEADER)!
    expect(parseIsedRow(ISED_ROWS[2], cols, parseRegionFilter(''))).toEqual(
      { call: 'VE7CCC', name: 'Example Radio Club', city: 'Saanich', region: 'BC' })
  })
  it('applies the region filter by province or postal prefix', () => {
    const cols = parseIsedHeader(ISED_HEADER)!
    expect(parseIsedRow(ISED_ROWS[1], cols, parseRegionFilter('BC'))).toBeNull()
    expect(parseIsedRow(ISED_ROWS[1], cols, parseRegionFilter('M5'))?.call).toBe('VA7BBB')
    expect(parseIsedRow(ISED_ROWS[0], cols, parseRegionFilter('V8Z'))?.call).toBe('VE7AAA')
  })
})

// FCC fixtures, pipe-delimited, no header.
// HD: HD|usi|uls|ebf|call|status ; EN: EN|usi|uls|ebf|call|type|licid|entity|first|mi|last|suffix|phone|fax|email|street|city|state|zip
const hd = (usi: string, call: string, status: string) => `HD|${usi}|0001||${call}|${status}|HA`
const en = (usi: string, call: string, type: string, entity: string, first: string, last: string, city: string, state: string, zip: string) =>
  `EN|${usi}|0001||${call}|${type}|L000|${entity}|${first}||${last}||555-0100||a@example.invalid|9 NOWHERE ST|${city}|${state}|${zip}`

describe('FCC parsing', () => {
  it('HD gives the id only for active licences', () => {
    expect(parseFccActiveUsi(hd('100', 'W7AAA', 'A'))).toBe('100')
    expect(parseFccActiveUsi(hd('101', 'W7BBB', 'E'))).toBeNull()
  })
  it('EN keeps only active, licensee, in-region rows, and drops private fields', () => {
    const active = new Set(['100', '102'])
    const f = parseRegionFilter('WA')
    const kept = parseFccEntityRow(en('100', 'W7AAA', 'L', 'SAMPLE, SAM', 'SAM', 'SAMPLE', 'SEATTLE', 'WA', '98101'), active, f)
    expect(kept).toEqual({ call: 'W7AAA', name: 'Sam Sample', city: 'Seattle', region: 'WA' })
    expect(JSON.stringify(kept)).not.toContain('NOWHERE')
    expect(JSON.stringify(kept)).not.toContain('example.invalid')
    expect(parseFccEntityRow(en('101', 'W7BBB', 'L', 'X', 'A', 'B', 'SEATTLE', 'WA', '98101'), active, f)).toBeNull()   // not active
    expect(parseFccEntityRow(en('102', 'W7CCC', 'CL', 'X', 'A', 'B', 'SEATTLE', 'WA', '98101'), active, f)).toBeNull()  // contact row
    expect(parseFccEntityRow(en('102', 'W7DDD', 'L', 'X', 'A', 'B', 'PORTLAND', 'OR', '97201'), active, f)).toBeNull()  // other state
    expect(parseFccEntityRow(en('102', 'W7DDD', 'L', 'X', 'A', 'B', 'PORTLAND', 'OR', '97201'), active, parseRegionFilter('972'))?.call).toBe('W7DDD')
  })
  it('uses the entity name for a club', () => {
    const row = parseFccEntityRow(en('100', 'W7EEE', 'L', 'EXAMPLE ARC', '', '', 'TACOMA', 'WA', '98401'), new Set(['100']), parseRegionFilter('WA'))
    expect(row?.name).toBe('Example Arc')
  })
})

describe('roleForEntry', () => {
  it('knows the files', () => {
    expect(roleForEntry('HD.dat')).toBe('fcc-status')
    expect(roleForEntry('x/EN.DAT')).toBe('fcc-people')
    expect(roleForEntry('amateur_delim.txt')).toBe('ised')
    expect(roleForEntry('readme.pdf')).toBeNull()
  })
})

// ── whole-file reads ────────────────────────────────────────────────────────────

function collect(): { rows: DirectoryRow[], sink: { put(r: DirectoryRow[]): Promise<void> } } {
  const rows: DirectoryRow[] = []
  return { rows, sink: { put: async r => { rows.push(...r) } } }
}
const noop = () => undefined

describe('importDirectoryFile', () => {
  it('reads a plain ISED text file', async () => {
    const file = new File([[ISED_HEADER, ...ISED_ROWS].join('\r\n')], 'amateur_delim.txt')
    const { rows, sink } = collect()
    const res = await importDirectoryFile(file, 'BC', sink, noop)
    expect(res.source).toBe('ised')
    expect(rows.map(r => r.call).sort()).toEqual(['VE7AAA', 'VE7CCC', 'VE7DDD'])
  })
  it('reads an ISED zip written in Windows-1252', async () => {
    const latin = new Uint8Array([
      ...strToU8([ISED_HEADER, ISED_ROWS[0]].join('\n') + '\n'),
      ...strToU8('VE7ZZZ;REN'), 0xC9, ...strToU8(';TESTER;1 X;SIDNEY;BC;V8L1A1;A;;;;;;;\n'),
    ])
    const file = new File([zipSync({ 'amateur_delim.txt': latin }) as BlobPart], 'amateur_delim.zip')
    const { rows, sink } = collect()
    await importDirectoryFile(file, '', sink, noop)
    expect(rows.find(r => r.call === 'VE7ZZZ')?.name).toBe('René Tester')
  })
  it('splits lines correctly across a large file read in many chunks', async () => {
    const lines = [ISED_HEADER]
    for (let i = 0; i < 20000; i++) lines.push(`VE7${String(i).padStart(5, '0')};PAT;N${i};1 X;VICTORIA;BC;V8Z1A1;A;;;;;;;`)
    const file = new File([lines.join('\n')], 'amateur_delim.txt')
    const { rows, sink } = collect()
    await importDirectoryFile(file, '', sink, noop)
    expect(rows.length).toBe(20000)
    expect(rows[19999].call).toBe('VE719999')
    expect(rows[19999].name).toBe('Pat N19999')
  })
  it('reports an ISED file with no call sign column', async () => {
    const file = new File(['a;b;c\n1;2;3\n'], 'amateur_delim.txt')
    await expect(importDirectoryFile(file, '', collect().sink, noop)).rejects.toBeInstanceOf(DirectoryImportError)
  })
  it('does the FCC two-pass: active only, in region only, and refuses a blank region', async () => {
    const hdText = [hd('1', 'W7AAA', 'A'), hd('2', 'W7BBB', 'E'), hd('3', 'W7CCC', 'A'), hd('4', 'W7DDD', 'A')].join('\r\n') + '\r\n'
    const enText = [
      en('1', 'W7AAA', 'L', 'X', 'AL', 'ONE', 'SEATTLE', 'WA', '98101'),
      en('2', 'W7BBB', 'L', 'X', 'BO', 'TWO', 'SEATTLE', 'WA', '98101'),      // expired
      en('3', 'W7CCC', 'L', 'X', 'CY', 'THREE', 'BOISE', 'ID', '83701'),      // other state
      en('4', 'W7DDD', 'L', 'X', 'DI', 'FOUR', 'SEQUIM', 'WA', '98382'),
      en('1', 'W7AAA', 'CL', 'X', 'CO', 'CONTACT', 'SEATTLE', 'WA', '98101'), // contact row for the same licence
    ].join('\n') + '\n'
    const file = new File([zipSync({ 'HD.dat': strToU8(hdText), 'EN.dat': strToU8(enText), 'AM.dat': strToU8('AM|x\n') }) as BlobPart], 'l_amat.zip')
    const { rows, sink } = collect()
    const phases: string[] = []
    const res = await importDirectoryFile(file, 'WA', sink, p => phases.push(p.phase))
    expect(res.source).toBe('fcc')
    expect(rows.map(r => r.call).sort()).toEqual(['W7AAA', 'W7DDD'])
    expect(res.count).toBe(2)
    await expect(importDirectoryFile(file, '', collect().sink, noop)).rejects.toThrow(/state or ZIP/)
  })
  it('rejects a file it does not know', async () => {
    await expect(importDirectoryFile(new File(['x'], 'photo.png'), '', collect().sink, noop)).rejects.toBeInstanceOf(DirectoryImportError)
  })
})

describe('streamLines', () => {
  it('only inflates the wanted entries', async () => {
    const file = new File([zipSync({ 'a.txt': strToU8('1\n2\n'), 'b.txt': strToU8('3\n') }) as BlobPart], 'z.zip')
    const seen: string[] = []
    await streamLines(file, n => n === 'a.txt', (_n, l) => seen.push(l), async () => undefined)
    expect(seen).toEqual(['1', '2'])
  })
})
