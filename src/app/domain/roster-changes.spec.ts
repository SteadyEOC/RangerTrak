import type { RangerType } from '../shared/services/ranger.interface'
import {
  baselineAfterImport, parseRosterImportBaseline, rangerFingerprint, rosterChanges, rosterChangesFile,
} from './roster-changes'

const r = (uid: string, callsign: string, extra: Partial<RangerType> = {}): RangerType => ({
  uid, callsign, id: '', fullName: `Name ${callsign}`, phone: '555-0100', image: '', team: '', role: '', note: '', ...extra,
})

describe('roster-changes (Export changes since import)', () => {
  const imported = [r('u1', 'A1'), r('u2', 'B1'), r('u3', 'C1')]
  const base = baselineAfterImport(imported, 'roster.json', 1000, 'replace')

  it('reports nothing when the roster is as imported', () => {
    const c = rosterChanges(imported, base)
    expect([c.added, c.edited, c.removed]).toEqual([[], [], []])
    expect(c.unchanged).toBe(3)
  })

  it('finds an added walk-up, an edited phone and a removed ranger', () => {
    const now = [r('u1', 'A1'), r('u2', 'B1', { phone: '555-0199' }), r('u9', 'WALKUP')]
    const c = rosterChanges(now, base)
    expect(c.added.map(x => x.callsign)).toEqual(['WALKUP'])
    expect(c.edited.map(x => x.callsign)).toEqual(['B1'])
    expect(c.removed).toEqual(['u3'])
    expect(c.unchanged).toBe(1)
  })

  it('ignores whitespace at either end and changes back to the original', () => {
    expect(rangerFingerprint(r('u1', 'A1', { fullName: '  Name A1 ' }))).toBe(rangerFingerprint(r('u1', 'A1')))
    const edited = r('u1', 'A1', { note: 'x' })
    expect(rangerFingerprint(edited)).not.toBe(rangerFingerprint(r('u1', 'A1')))
    expect(rosterChanges([{ ...edited, note: '' }, imported[1], imported[2]], base).edited).toEqual([])
  })

  it('a merge re-baselines only the rows it wrote; an earlier walk-up stays added', () => {
    const walkUp = r('u9', 'WALKUP')
    const merged = [r('u1', 'A1', { phone: '555-0111' }), imported[1], imported[2], walkUp]
    const after = baselineAfterImport(merged, 'setup.zip', 2000, 'merge', base, ['u1'])
    const c = rosterChanges(merged, after)
    expect(c.added.map(x => x.callsign)).toEqual(['WALKUP'])
    expect(c.edited).toEqual([])
    expect(c.source).toBe('setup.zip')
    expect(c.importedAt).toBe(2000)
  })

  it('a merge onto a device with no baseline records just the merged rows', () => {
    const after = baselineAfterImport(imported, 'setup.zip', 2000, 'merge', null, ['u2'])
    expect(Object.keys(after.rows)).toEqual(['u2'])
  })

  it('stores hashes only, never the roster fields', () => {
    const text = JSON.stringify(baselineAfterImport([r('u1', 'K7ABC', { fullName: 'Jo Example', phone: '555-0123' })], 'f', 1, 'replace'))
    expect(text).not.toContain('K7ABC')
    expect(text).not.toContain('Jo Example')
    expect(text).not.toContain('555-0123')
  })

  it('parses a stored baseline, and reads anything malformed as none', () => {
    expect(parseRosterImportBaseline(JSON.stringify(base))).toEqual(base)
    expect(parseRosterImportBaseline(null)).toBeNull()
    expect(parseRosterImportBaseline('not json')).toBeNull()
    expect(parseRosterImportBaseline('{"rows":{}}')).toBeNull()
  })

  it('the export is roster-shaped, with each row marked and removed uids listed', () => {
    const c = rosterChanges([r('u1', 'A1', { phone: '555-0199' }), imported[1], r('u9', 'WALKUP')], base)
    const file = rosterChangesFile(c, Date.UTC(2026, 9, 5))
    expect(file.rangers.map(x => [x.callsign, x.change])).toEqual([['WALKUP', 'added'], ['A1', 'edited']])
    expect(file.rangers.every(x => !!x.uid)).toBeTrue()
    expect(file.removedUids).toEqual(['u3'])
    expect(file.counts).toEqual({ added: 1, edited: 1, removed: 1 })
    expect(file.exportedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(file.importedFrom).toBe('roster.json')
  })
})
