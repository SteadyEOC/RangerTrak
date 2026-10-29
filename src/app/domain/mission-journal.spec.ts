import {
  JOURNAL_GENESIS, JOURNAL_MAX_ENTRIES, JournalDraft, JournalEntry, MISSION_JOURNAL_SCHEMA_VERSION,
  appendEntry, describeCheck, journalToCsv, migrateMissionJournal, sha256Hex, shortHead, verifyJournal,
} from './mission-journal'

const draft = (n: number, summary = `Did thing ${n}.`): JournalDraft =>
  ({ action: 'print-309', summary, mission: 'Oso', mode: 'incident' })

function chain(n: number): JournalEntry[] {
  let list: JournalEntry[] = []
  for (let i = 1; i <= n; i++) list = appendEntry(list, draft(i), new Date(Date.UTC(2026, 9, 23, 12, i)))
  return list
}

describe('sha256Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('agrees with crypto.subtle, including non-ASCII and lengths around a block', async () => {
    for (const s of ['Café ✓', 'hello world', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200), '日本語']) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
      const hex = Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
      expect(sha256Hex(s)).withContext(s.slice(0, 10)).toBe(hex)
    }
  })
})

describe('mission journal chain', () => {
  it('verifies a chain of 3, starting from the genesis hash', () => {
    const list = chain(3)
    expect(list.map(e => e.seq)).toEqual([1, 2, 3])
    expect(list[0].prev).toBe(JOURNAL_GENESIS)
    expect(list[1].prev).toBe(list[0].hash)
    expect(verifyJournal(list)).toEqual({ ok: true, count: 3, trimmedBefore: 0, head: list[2].hash })
  })

  it('reports the entry whose summary was edited', () => {
    const list = chain(3).map(e => e.seq === 2 ? { ...e, summary: 'Changed.' } : e)
    expect(verifyJournal(list).brokenAt).toBe(2)
  })

  it('reports the entry after a deleted one', () => {
    const check = verifyJournal(chain(3).filter(e => e.seq !== 2))
    expect(check.ok).toBeFalse()
    expect(check.brokenAt).toBe(3)
  })

  it('stays intact when trimmed, and reports how many went', () => {
    let list: JournalEntry[] = []
    for (let i = 0; i < JOURNAL_MAX_ENTRIES + 3; i++) list = appendEntry(list, draft(i), new Date(0))
    expect(list.length).toBe(JOURNAL_MAX_ENTRIES)
    const check = verifyJournal(list)
    expect(check.ok).toBeTrue()
    expect(check.trimmedBefore).toBe(3)
    expect(list[0].seq).toBe(4)
    expect(describeCheck(check)).toContain('Intact from entry 4 (3 earlier entries trimmed)')
  })

  it('round-trips quotes and newlines through JSON', () => {
    const list = appendEntry([], draft(1, 'Said "go"\nthen, left.'), new Date(0))
    const back = JSON.parse(JSON.stringify(list)) as JournalEntry[]
    expect(verifyJournal(back).ok).toBeTrue()
    expect(journalToCsv(back)).toContain('"Said ""go""\nthen, left."')
  })

  it('shortHead is the first and last four characters and the count', () => {
    expect(shortHead('3f9a' + '0'.repeat(56) + 'c21b', 143)).toBe('jrnl 3f9a·c21b (143)')
  })

  it('describes an intact and a broken journal in plain words', () => {
    const list = chain(2)
    expect(describeCheck(verifyJournal(list))).toMatch(/^Journal intact: 2 entries, latest [0-9a-f]{4}…[0-9a-f]{4}$/)
    expect(describeCheck(verifyJournal([{ ...list[0], summary: 'x' }, list[1]]))).toBe('Journal broken at entry 1')
    expect(describeCheck(verifyJournal(chain(1)))).toMatch(/^Journal intact: 1 entry, latest /)
  })
})

describe('migrateMissionJournal', () => {
  it('reads nothing as an empty journal', () => {
    expect(migrateMissionJournal(null)).toEqual({ schemaVersion: MISSION_JOURNAL_SCHEMA_VERSION, entries: [] })
  })

  it('keeps entries untouched and drops non-entries', () => {
    const list = chain(2)
    const out = migrateMissionJournal({ schemaVersion: 1, entries: [list[0], 'junk', null, list[1]] })
    expect(out.entries).toEqual(list)
  })
})
