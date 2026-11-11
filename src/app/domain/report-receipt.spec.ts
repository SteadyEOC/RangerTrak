import { buildReceipt, parseReceipt, receiptFilename, REPORT_RECEIPT_KIND } from './report-receipt'

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
})
