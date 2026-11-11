import { buildReceipt, msgNoRanges, parseReceipt, receiptFilename, receiptOpenMessage, REPORT_RECEIPT_KIND } from './report-receipt'

const NOW = new Date(2026, 10, 11, 14, 32)
const log = [
  { uid: 'u1', msgNo: { mission: 'M', opPeriod: '1', station: 'A', seq: 7 }, notes: 'Jane Doe at 12 Elm St', location: { lat: 1, lon: 2 } },
  { uid: 'u2', msgNo: { mission: 'M', opPeriod: '1', station: 'A', seq: 8 }, notes: 'secret', name: 'Bob' },
  { uid: 'u3' },
]
const base = { logEntries: log, mission: 'Search 3', station: 'A', appVersion: '1.0.0', now: NOW }

describe('report receipt', () => {
  it('lists packet uids that are in the log, with their short numbers', () => {
    const r = buildReceipt({ ...base, packetUids: ['u1', 'u2'] })
    expect(r.kind).toBe(REPORT_RECEIPT_KIND)
    expect(r.entries).toEqual([{ uid: 'u1', msgNo: 'A007' }, { uid: 'u2', msgNo: 'A008' }])
  })

  it('leaves out uids not in the log and repeated uids', () => {
    const r = buildReceipt({ ...base, packetUids: ['u1', 'nope', 'u1'] })
    expect(r.entries.map(e => e.uid)).toEqual(['u1'])
  })

  it('carries no notes, names or locations', () => {
    const text = JSON.stringify(buildReceipt({ ...base, packetUids: ['u1', 'u2'] }))
    for (const s of ['Jane', 'Elm', 'secret', 'Bob', 'lat', 'notes', 'location']) expect(text).not.toContain(s)
  })

  it('names the file by mission and local time', () => {
    expect(receiptFilename('Vashon Search #3!', NOW)).toBe('rangertrak-receipt-Vashon_Search_3_-2026-11-11-1432.txt')
    expect(receiptFilename('', NOW)).toContain('receipt-mission-')
  })

  it('round-trips through parseReceipt', () => {
    const r = buildReceipt({ ...base, packetUids: ['u1', 'u2'] })
    const p = parseReceipt(JSON.stringify(r))
    expect(p.ok && p.receipt.entries).toEqual(r.entries)
    expect(p.ok && p.skipped).toBe(0)
  })

  it('says plainly what is wrong', () => {
    const bad = (t: string) => { const p = parseReceipt(t); return p.ok ? '' : p.message }
    expect(bad('{nope')).toContain('not a receipt')
    expect(bad('[]')).toContain('not a receipt')
    expect(bad(JSON.stringify({ schemaVersion: 1, entries: [] }))).toContain('Report Packet, not a receipt')
    expect(bad(JSON.stringify({ kind: REPORT_RECEIPT_KIND, schemaVersion: 99, entries: [] }))).toContain('newer')
    expect(bad(JSON.stringify({ kind: REPORT_RECEIPT_KIND, schemaVersion: 1, entries: [{ x: 1 }] }))).toContain('no readable')
    expect(bad(JSON.stringify({ kind: REPORT_RECEIPT_KIND, schemaVersion: 1, entries: [] }))).toContain('no reports')
  })

  it('skips bad rows and counts them', () => {
    const p = parseReceipt(JSON.stringify({ kind: REPORT_RECEIPT_KIND, schemaVersion: 1,
      entries: [{ uid: 'a', msgNo: 'A001' }, { uid: 5 }, null, { uid: 'b' }] }))
    expect(p.ok && p.receipt.entries.map(e => e.uid)).toEqual(['a', 'b'])
    expect(p.ok && p.skipped).toBe(2)
  })

  it('writes message numbers as short runs', () => {
    expect(msgNoRanges(['A033', 'A031', 'A032'])).toBe('A031–A033')
    expect(msgNoRanges(['A031', 'A033', 'A040'])).toBe('A031, A033, A040')
    expect(msgNoRanges(['A001', 'A003', 'A005', 'A007', 'A009', 'B001'])).toBe('A001, A003, A005, A007 and 2 more')
    expect(msgNoRanges(['A007', 'A007', ''])).toBe('A007')
  })

  it('words what opening a receipt did', () => {
    const base = { changed: 0, held: 0, notHeld: 0, skipped: 0, msgNos: [] as string[] }
    expect(receiptOpenMessage({ ...base, changed: 7, held: 7, notHeld: 2, msgNos: ['A031', 'A032', 'A033', 'A034', 'A035', 'A036', 'A037'] }))
      .toBe('7 reports confirmed received (A031–A037). 2 in the receipt are not on this phone.')
    expect(receiptOpenMessage({ ...base, held: 3 })).toBe('Nothing new: these reports were already marked received.')
    expect(receiptOpenMessage({ ...base, notHeld: 4 })).toBe('None of the reports in this receipt are on this phone.')
    expect(receiptOpenMessage({ ...base, changed: 1, held: 1, msgNos: ['A001'], skipped: 1 }))
      .toBe('1 report confirmed received (A001). 1 entry in the file could not be read.')
  })
})
