import type { AarNoteType } from '../shared/services/aar-note.interface'
import {
  ACTIVITY_CELL_MAX_WIDTH,
  buildActivityRows,
  chunkActivityRows,
  formatActivityTime,
  hasOpPeriod,
  normalizeActivityLogHeader,
  selectActivityLines,
  suggestActivityFromJournal,
  toWinAnsi,
  wrapText,
} from './activity-log'
import { JournalEntry, appendEntry } from './mission-journal'

let uid = 0
const line = (createdAt: string, over: Partial<AarNoteType> = {}): AarNoteType => ({
  uid: 'l' + uid++,
  createdAt,
  text: 'Net opened',
  page: 'Entry',
  about: 'incident',
  kind: 'activity',
  ...over,
})

describe('activity-log (E-04 / D-63)', () => {
  const OP = {
    opPeriodStart: new Date(2026, 9, 20, 8),
    opPeriodEnd: new Date(2026, 9, 20, 20),
  }

  describe('selectActivityLines', () => {
    const inside = line(new Date(2026, 9, 20, 9).toISOString(), { text: 'inside' })
    const outside = line(new Date(2026, 9, 21, 9).toISOString(), { text: 'outside' })
    const aar = line(new Date(2026, 9, 20, 10).toISOString(), {
      kind: 'aar',
      text: 'a debrief note',
    })

    it('keeps activity lines only, never AAR notes', () => {
      expect(selectActivityLines([inside, aar], OP, false).map((n) => n.text)).toEqual([
        'inside',
      ])
    })
    it('limits to the operational period when asked, both ends included', () => {
      const atStart = line(OP.opPeriodStart.toISOString(), { text: 'start' })
      const atEnd = line(OP.opPeriodEnd.toISOString(), { text: 'end' })
      expect(
        selectActivityLines([outside, atEnd, inside, atStart], OP, true).map(
          (n) => n.text
        )
      ).toEqual(['start', 'inside', 'end'])
      expect(selectActivityLines([outside, inside], OP, false).length).toBe(2)
    })
    it('takes every line when the mission has no operational period', () => {
      const none = { opPeriodStart: new Date(0), opPeriodEnd: new Date(0) }
      expect(hasOpPeriod(none)).toBe(false)
      expect(selectActivityLines([outside, inside], none, true).length).toBe(2)
    })
    it('sorts by the edited time, not the capture time', () => {
      const late = line(new Date(2026, 9, 20, 9).toISOString(), {
        text: 'logged late',
        at: new Date(2026, 9, 20, 7).toISOString(),
      })
      const early = line(new Date(2026, 9, 20, 8).toISOString(), { text: 'on time' })
      expect(selectActivityLines([early, late], OP, false).map((n) => n.text)).toEqual([
        'logged late',
        'on time',
      ])
    })
  })

  describe('rows', () => {
    it('formats a short local time', () => {
      expect(formatActivityTime(new Date(2026, 9, 20, 14, 5).toISOString())).toBe(
        '10/20 14:05'
      )
      expect(formatActivityTime('junk')).toBe('')
    })
    it('keeps a short line on one row', () => {
      const rows = buildActivityRows([
        line(new Date(2026, 9, 20, 14, 5).toISOString(), {
          text: 'Arrived at the command post',
        }),
      ])
      expect(rows).toEqual([{ time: '10/20 14:05', text: 'Arrived at the command post' }])
    })
    it('wraps a long line onto following rows with a blank time, losing no words', () => {
      const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
      const rows = buildActivityRows([
        line(new Date(2026, 9, 20, 14, 5).toISOString(), { text }),
      ])
      expect(rows.length).toBeGreaterThan(1)
      expect(rows[0].time).toBe('10/20 14:05')
      expect(rows.slice(1).every((r) => r.time === '')).toBe(true)
      expect(rows.map((r) => r.text).join(' ')).toBe(text)
    })
    it('breaks a word wider than a row rather than overflowing', () => {
      const parts = wrapText('W'.repeat(120))
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.join('')).toBe('W'.repeat(120))
    })
    it('starts a new row at a line break', () => {
      const rows = buildActivityRows([
        line(new Date(2026, 9, 20, 14, 5).toISOString(), { text: 'one\ntwo' }),
      ])
      expect(rows.map((r) => r.text)).toEqual(['one', 'two'])
      expect(rows[1].time).toBe('')
    })
    it('replaces what the form font cannot print', () => {
      expect(toWinAnsi('Café “ok” 😀')).toBe('Café “ok” ?')
      expect(ACTIVITY_CELL_MAX_WIDTH).toBeLessThan(443)
    })
  })

  describe('chunkActivityRows', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ time: '', text: String(i) }))
    it('gives one empty sheet for nothing', () => {
      expect(chunkActivityRows([]).map((s) => s.length)).toEqual([0])
    })
    it('puts 24 on the first sheet and 36 on each continuation', () => {
      expect(chunkActivityRows(rows(24)).map((s) => s.length)).toEqual([24])
      expect(chunkActivityRows(rows(25)).map((s) => s.length)).toEqual([24, 1])
      expect(chunkActivityRows(rows(61)).map((s) => s.length)).toEqual([24, 36, 1])
      expect(chunkActivityRows(rows(96)).map((s) => s.length)).toEqual([24, 36, 36])
    })
  })

  describe('normalizeActivityLogHeader', () => {
    it('gives the empty header for junk', () => {
      for (const raw of [null, undefined, 'x', 4]) {
        expect(normalizeActivityLogHeader(raw)).toEqual({
          name: '',
          icsPosition: '',
          homeAgency: '',
          resources: [],
        })
      }
    })
    it('trims, drops empty resource rows and caps at 8', () => {
      const resources = Array.from({ length: 12 }, (_, i) => ({
        name: ` R${i} `,
        icsPosition: '',
        homeAgency: '',
      }))
      const h = normalizeActivityLogHeader({
        name: ' Pat ',
        icsPosition: 7,
        resources: [{}, ...resources],
      })
      expect(h.name).toBe('Pat')
      expect(h.icsPosition).toBe('')
      expect(h.resources.length).toBe(8)
      expect(h.resources[0].name).toBe('R0')
    })
    it('is idempotent', () => {
      const once = normalizeActivityLogHeader({
        name: 'Pat',
        resources: [{ name: 'A', homeAgency: 'B' }],
      })
      expect(normalizeActivityLogHeader(once)).toEqual(once)
    })
  })
  describe('suggestActivityFromJournal (E-222)', () => {
    const OPW = {
      opPeriodStart: new Date(2026, 9, 20, 8),
      opPeriodEnd: new Date(2026, 9, 20, 20),
    }
    const at = (h: number) => new Date(2026, 9, 20, h)
    function journalOf(
      ...items: [number, JournalEntry['action'], string][]
    ): JournalEntry[] {
      let list: JournalEntry[] = []
      for (const [h, action, summary] of items)
        list = appendEntry(list, { action, summary, mission: 'm', mode: '' }, at(h))
      return list
    }

    it('keeps mission and data actions in scope, drops the 213 print and out-of-period ones', () => {
      const j = journalOf(
        [9, 'print-309', 'a'],
        [10, 'print-213', 'b'],
        [23, 'backup-exported', 'c'],
        [11, 'roster-imported', 'd']
      )
      expect(suggestActivityFromJournal(j, [], OPW, true).map((e) => e.summary)).toEqual([
        'a',
        'd',
      ])
      expect(suggestActivityFromJournal(j, [], OPW, false).map((e) => e.summary)).toEqual(
        ['a', 'c', 'd']
      )
    })

    it('hides one that already has a line with the same time and text', () => {
      const j = journalOf([9, 'print-309', 'a'], [11, 'roster-imported', 'd'])
      const existing = line(j[0].at, { text: 'a', at: j[0].at })
      expect(
        suggestActivityFromJournal(j, [existing], OPW, false).map((e) => e.summary)
      ).toEqual(['d'])
    })
  })
})
