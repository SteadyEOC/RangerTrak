import { buildCallsignFile, callsignCheckboxLabel, describeCallsignReplace, parseCallsignFile } from './callsign-setup'
import type { DirectoryMeta, DirectoryRow } from './callsign-directory'

const meta: DirectoryMeta = { source: 'ised', importedAt: '2026-11-18T09:00:00.000Z', fileName: 'amateur_delim.txt', region: 'BC', count: 2 }
const rows: DirectoryRow[] = [
  { call: 'VE7AAA', name: 'Pat Example', city: 'Victoria', region: 'BC' },
  { call: 'VA7BBB', name: 'Sam Sample', city: 'Duncan', region: 'BC' },
]

describe('callsign Setup file entry (E-328)', () => {
  it('builds with only the four public fields and the import details', () => {
    const withExtras = rows.map(r => ({ ...r, phone: '555', address: '1 Main' })) as DirectoryRow[]
    const file = buildCallsignFile(meta, withExtras)
    expect(file.rows).toEqual(rows)
    expect(JSON.stringify(file)).not.toContain('555')
    expect(file).toMatchObject({ source: 'ised', fileName: 'amateur_delim.txt', importedAt: meta.importedAt, count: 2 })
  })

  it('round-trips through JSON', () => {
    const back = parseCallsignFile(JSON.parse(JSON.stringify(buildCallsignFile(meta, rows))))
    expect(back?.rows).toEqual(rows)
    expect(back?.meta).toMatchObject({ source: 'ised', fileName: 'amateur_delim.txt', count: 2 })
  })

  it('reading drops extra fields, upper-cases calls and skips junk rows', () => {
    const back = parseCallsignFile({ source: 'fcc', rows: [{ call: 'w1abc', name: 'A', city: 'B', region: 'WA', ssn: '1' }, null, { name: 'no call' }] })
    expect(back?.rows).toEqual([{ call: 'W1ABC', name: 'A', city: 'B', region: 'WA' }])
    expect(back?.meta.count).toBe(1)
  })

  it('anything unusable reads as null, so the rest of the file still applies', () => {
    expect(parseCallsignFile(null)).toBeNull()
    expect(parseCallsignFile('x')).toBeNull()
    expect(parseCallsignFile({ source: 'ised', rows: [] })).toBeNull()
    expect(parseCallsignFile({ source: 'other', rows: [{ call: 'A' }] })).toBeNull()
  })

  it('words the checkbox and the summary', () => {
    expect(callsignCheckboxLabel(meta)).toBe('Include the call sign list (2 call signs, from amateur_delim.txt, 2026-11-18)')
    expect(describeCallsignReplace(meta)).toBe('Call sign list replaced: 2 call signs from amateur_delim.txt')
  })
})
