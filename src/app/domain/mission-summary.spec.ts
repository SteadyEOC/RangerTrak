import type { AarNoteType } from '../shared/services/aar-note.interface'
import type {
  RadioLogEntryType,
  RadioLogStatusType,
} from '../shared/services/radio-log-entry.interface'
import type { RangerType } from '../shared/services/ranger.interface'
import {
  NO_AREA_LABEL,
  NO_STATION_LABEL,
  NO_TEAM_LABEL,
  NOT_RECORDED_LABEL,
  summarizeMission,
  UNKNOWN_STATUS_COLOR,
  type SummaryInput,
} from './mission-summary'

// All times are built local (new Date(y, m, d, h, min)) so the spec passes in any time zone.
const at = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min)

let nextId = 1
const entry = (when: Date, over: Partial<RadioLogEntryType> = {}): RadioLogEntryType =>
  ({
    id: nextId++,
    callsign: 'K7AAA',
    date: when,
    status: 'Normal',
    notes: '',
    location: { lat: 1, lng: 1, address: '', derivedFromAddress: false },
    ...over,
  }) as RadioLogEntryType

const STATUSES: RadioLogStatusType[] = [
  { status: 'Normal', color: 'normal', icon: '' },
  { status: 'Urgent', color: 'urgent', icon: '' },
  { status: 'Unused', color: 'location-report', icon: '' },
]

const note = (createdAt: Date, over: Partial<AarNoteType> = {}): AarNoteType => ({
  uid: 'n' + nextId++,
  createdAt: createdAt.toISOString(),
  text: 'x',
  page: 'Entry',
  about: 'incident',
  kind: 'aar',
  ...over,
})

const ranger = (over: Partial<RangerType>): RangerType => ({
  callsign: '',
  fullName: '',
  phone: '',
  image: '',
  team: '',
  role: '',
  note: '',
  ...over,
})

const NOW = at(20, 12)
function run(over: Partial<SummaryInput> = {}) {
  return summarizeMission({
    entries: [],
    rangers: [],
    statuses: STATUSES,
    notes: [],
    window: null,
    now: NOW,
    ...over,
  })
}

describe('summarizeMission', () => {
  it('handles an empty log', () => {
    const s = run()
    expect(s.totals.entries).toBe(0)
    expect(s.totals.stations).toBe(0)
    expect(s.totals.first).toBeNull()
    expect(s.totals.last).toBeNull()
    expect(s.buckets.items.length).toBe(1)
    expect(s.buckets.items[0].count).toBe(0)
    expect(s.byTeam).toEqual([])
    expect(s.attention).toEqual([])
    expect(s.window.wholeLog).toBe(true)
    expect(s.window.soFar).toBe(false)
    expect(s.generatedAt).toEqual(NOW)
  })

  it('whole log: the window is the first and last entry times', () => {
    const s = run({
      entries: [entry(at(15, 10)), entry(at(15, 8, 30)), entry(at(15, 14))],
    })
    expect(s.window.from).toEqual(at(15, 8, 30))
    expect(s.window.to).toEqual(at(15, 14))
    expect(s.totals.entries).toBe(3)
    expect(s.totals.first).toEqual(at(15, 8, 30))
    expect(s.totals.last).toEqual(at(15, 14))
  })

  it('clips to the window: entries before and after are excluded, the edges are included', () => {
    const s = run({
      entries: [
        entry(at(15, 7, 59)),
        entry(at(15, 8)),
        entry(at(15, 12)),
        entry(at(15, 12, 1)),
      ],
      window: { from: at(15, 8), to: at(15, 12) },
    })
    expect(s.totals.entries).toBe(2)
    expect(s.window.wholeLog).toBe(false)
  })

  it('an op period whose end is still in the future is summarised "so far"', () => {
    const s = run({
      entries: [entry(at(20, 9)), entry(at(20, 13))], // the second is "after now"
      window: { from: at(20, 8), to: at(20, 18) },
    })
    expect(s.window.soFar).toBe(true)
    expect(s.window.to).toEqual(NOW)
    expect(s.totals.entries).toBe(1)
    expect(run({ window: { from: at(19, 8), to: at(19, 18) } }).window.soFar).toBe(false)
  })

  describe('bucket size', () => {
    const sizeFor = (hours: number) => {
      const s = run({
        entries: [entry(at(1, 0))],
        window: { from: at(1, 0), to: new Date(2026, 9, 1, hours) },
      })
      return { hours: s.buckets.hours, bars: s.buckets.items.length }
    }
    it('6 h window: hourly bars', () => expect(sizeFor(6)).toEqual({ hours: 1, bars: 6 }))
    it('47 h window: still hourly', () =>
      expect(sizeFor(47)).toEqual({ hours: 1, bars: 47 }))
    it('48 h window: still hourly, exactly 48 bars', () =>
      expect(sizeFor(48)).toEqual({ hours: 1, bars: 48 }))
    it('49 h window: 2-hour bars', () =>
      expect(sizeFor(49)).toEqual({ hours: 2, bars: 25 }))
    it('9 days: 6-hour bars', () =>
      expect(sizeFor(9 * 24)).toEqual({ hours: 6, bars: 36 }))
    it('never more than 48 bars while a 24 h bucket can manage it', () => {
      expect(sizeFor(40 * 24).bars).toBeLessThanOrEqual(48)
    })
  })

  it('starts at the window start floored to the bucket, and crosses midnight without gaps', () => {
    // 22:30 -> 02:15 next day: hourly, first bar 22:00, bars 22,23,00,01,02.
    const s = run({
      entries: [entry(at(14, 22, 45)), entry(at(15, 1, 10))],
      window: { from: at(14, 22, 30), to: at(15, 2, 15) },
    })
    expect(s.buckets.hours).toBe(1)
    expect(s.buckets.items.map((b) => b.start)).toEqual([
      at(14, 22),
      at(14, 23),
      at(15, 0),
      at(15, 1),
      at(15, 2),
    ])
    expect(s.buckets.items.map((b) => b.count)).toEqual([1, 0, 0, 1, 0])
  })

  it('zero-fills the quiet hours', () => {
    const s = run({ entries: [entry(at(15, 8)), entry(at(15, 12, 30))] })
    expect(s.buckets.items.map((b) => b.count)).toEqual([1, 0, 0, 0, 1])
  })

  it('counts attention entries within each bar', () => {
    const s = run({
      entries: [
        entry(at(15, 8)),
        entry(at(15, 8, 5), { status: 'Urgent' }),
        entry(at(15, 9)),
      ],
    })
    expect(s.buckets.items[0]).toEqual(
      expect.objectContaining({ count: 2, attentionCount: 1 })
    )
    expect(s.buckets.items[1].attentionCount).toBe(0)
  })

  it('floors multi-hour bars to a multiple of the bar size', () => {
    const s = run({ entries: [entry(at(14, 7)), entry(at(16, 20))] }) // 61 h: 2-hour bars
    expect(s.buckets.hours).toBe(2)
    expect(s.buckets.items[0].start).toEqual(at(14, 6))
  })

  describe('status', () => {
    it('follows the mission order, drops zero counts, puts unknown statuses last in a neutral colour', () => {
      const s = run({
        entries: [
          entry(at(15, 8), { status: 'Urgent' }),
          entry(at(15, 9), { status: 'Mystery' }),
          entry(at(15, 10)),
          entry(at(15, 11)),
        ],
      })
      expect(s.byStatus.map((r) => [r.status, r.count])).toEqual([
        ['Normal', 2],
        ['Urgent', 1],
        ['Mystery', 1],
      ])
      expect(s.byStatus[0].color).toBe('normal')
      expect(s.byStatus[2].color).toBe(UNKNOWN_STATUS_COLOR)
      expect(s.byStatus[2].inSettings).toBe(false)
    })
  })

  describe('team', () => {
    const rangers = [
      ranger({ uid: 'u1', callsign: 'K7AAA', team: 'Alpha' }),
      ranger({ uid: 'u2', callsign: 'K7BBB', team: 'Bravo' }),
      ranger({ uid: 'u3', callsign: 'K7CCC', team: '  ' }),
    ]
    it('finds the team via rangerUid, even when the call sign on the entry differs', () => {
      const s = run({
        rangers,
        entries: [entry(at(15, 8), { rangerUid: 'u2', callsign: 'OLD' })],
      })
      expect(s.byTeam).toEqual([{ label: 'Bravo', count: 1 }])
    })
    it('falls back to the exact call sign', () => {
      const s = run({
        rangers,
        entries: [
          entry(at(15, 8), { callsign: 'K7AAA' }),
          entry(at(15, 9), { callsign: 'k7aaa' }),
        ],
      })
      expect(s.byTeam).toEqual([
        { label: 'Alpha', count: 1 },
        { label: NO_TEAM_LABEL, count: 1 },
      ])
    })
    it('splits each team by status, in the mission status order', () => {
      const s = run({
        rangers,
        entries: [
          entry(at(15, 8), { callsign: 'K7AAA', status: 'Urgent' }),
          entry(at(15, 9), { callsign: 'K7AAA' }),
          entry(at(15, 10), { callsign: 'K7AAA' }),
        ],
      })
      expect(s.byTeamStatus['Alpha']).toEqual([
        { status: 'Normal', count: 2 },
        { status: 'Urgent', count: 1 },
      ])
    })
    it('no ranger, or a blank team, is "No team / not on roster", sorted by count', () => {
      const s = run({
        rangers,
        entries: [
          entry(at(15, 8), { callsign: 'ZZZ' }),
          entry(at(15, 9), { callsign: 'K7CCC' }),
          entry(at(15, 10), { callsign: '' }),
          entry(at(15, 11), { rangerUid: 'u1' }),
        ],
      })
      expect(s.byTeam).toEqual([
        { label: NO_TEAM_LABEL, count: 3 },
        { label: 'Alpha', count: 1 },
      ])
    })
  })

  describe('station', () => {
    it('keeps two unstaffed tactical calls as two stations, and neither-name entries under one label', () => {
      const s = run({
        entries: [
          entry(at(15, 8), { callsign: '', tacticalCall: 'Medical' }),
          entry(at(15, 9), { callsign: '', tacticalCall: 'Staging' }),
          entry(at(15, 10), { callsign: '' }),
          entry(at(15, 11), { callsign: '' }),
        ],
      })
      expect(s.totals.stations).toBe(3)
      expect(s.byStation.map((r) => [r.station, r.count])).toEqual([
        [NO_STATION_LABEL, 2],
        ['Medical', 1],
        ['Staging', 1],
      ])
    })
    it('uses the shared station format and records when it was last heard', () => {
      const s = run({
        entries: [
          entry(at(15, 8), { tacticalCall: 'Team 1' }),
          entry(at(15, 11), { tacticalCall: 'Team 1' }),
          entry(at(15, 9), { tacticalCall: 'Team 1' }),
        ],
      })
      expect(s.byStation).toEqual([
        { station: 'Team 1 (K7AAA)', count: 3, lastHeard: at(15, 11) },
      ])
    })
  })

  it('operator: blank is "(not recorded)", never the current scribe', () => {
    const s = run({
      entries: [
        entry(at(15, 8), { operator: 'Pat' }),
        entry(at(15, 9), { operator: '  ' }),
        entry(at(15, 10)),
      ],
    })
    expect(s.byOperator).toEqual([
      { label: NOT_RECORDED_LABEL, count: 2 },
      { label: 'Pat', count: 1 },
    ])
  })

  it('source: blank is "(not recorded)"', () => {
    const s = run({ entries: [entry(at(15, 8), { source: 'Voice' }), entry(at(15, 9))] })
    expect(s.bySource.map((r) => r.label).sort()).toEqual(
      [NOT_RECORDED_LABEL, 'Voice'].sort()
    )
  })

  describe('late and revised', () => {
    it('counts late (more than 15 min), not on-time, not entries without loggedAt', () => {
      const s = run({
        entries: [
          entry(at(15, 8), { loggedAt: at(15, 8, 15) }), // exactly 15: on time
          entry(at(15, 9), { loggedAt: at(15, 9, 16) }), // late
          entry(at(15, 10)), // no loggedAt: not late
          entry(at(15, 11), { loggedAt: at(15, 10, 50) }), // logged "before" it happened: not late
        ],
      })
      expect(s.totals.late).toBe(1)
    })
    it('counts entries edited after logging', () => {
      const s = run({
        entries: [entry(at(15, 8), { revisedAt: at(15, 9) }), entry(at(15, 9))],
      })
      expect(s.totals.revised).toBe(1)
    })
    it('uses the entry date, not loggedAt, for the window', () => {
      const s = run({
        entries: [entry(at(15, 8), { loggedAt: at(16, 8) })],
        window: { from: at(15, 0), to: at(15, 23) },
      })
      expect(s.totals.entries).toBe(1)
    })
  })

  describe('needs attention', () => {
    it('lists flagged statuses newest first', () => {
      const s = run({
        entries: [
          entry(at(15, 8), { status: 'Urgent' }),
          entry(at(15, 9)),
          entry(at(15, 10), { status: 'Urgent' }),
        ],
      })
      expect(s.attention.map((e) => e.date)).toEqual([at(15, 10), at(15, 8)])
      expect(s.totals.attention).toBe(2)
    })
    it('respects an explicit flagOnMap override either way', () => {
      const statuses: RadioLogStatusType[] = [
        { status: 'Normal', color: 'normal', icon: '', flagOnMap: true },
        { status: 'Urgent', color: 'urgent', icon: '', flagOnMap: false },
      ]
      const s = run({
        statuses,
        entries: [
          entry(at(15, 8), { status: 'Urgent' }),
          entry(at(15, 9), { status: 'Normal' }),
        ],
      })
      expect(s.attention.map((e) => e.status)).toEqual(['Normal'])
      expect(s.buckets.items.reduce((n, b) => n + b.attentionCount, 0)).toBe(1)
    })
  })

  describe('AAR notes', () => {
    it('groups incident notes by area across case and blanks, oldest first, first spelling wins', () => {
      const s = run({
        entries: [entry(at(15, 8))],
        notes: [
          note(at(15, 12), { text: 'c', area: 'communications ' }),
          note(at(15, 9), { text: 'a', area: 'Communications' }),
          note(at(15, 10), { text: 'b' }),
          note(at(15, 11), { text: 'd', area: '   ' }),
          note(at(15, 13), { text: 'e', area: 'Logistics' }),
        ],
        window: { from: at(15, 0), to: at(15, 23) },
      })
      expect(s.aar.groups.map((g) => [g.area, g.notes.map((n) => n.text)])).toEqual([
        ['Communications', ['a', 'c']],
        [NO_AREA_LABEL, ['b', 'd']],
        ['Logistics', ['e']],
      ])
      expect(s.aar.incidentCount).toBe(5)
    })
    it('counts RangerTrak notes without listing them', () => {
      const s = run({
        notes: [
          note(at(15, 9), { about: 'app' }),
          note(at(15, 10), { about: 'app' }),
          note(at(15, 11)),
        ],
      })
      expect(s.aar.appCount).toBe(2)
      expect(s.aar.groups.flatMap((g) => g.notes).length).toBe(1)
    })

    // E-04 / D-63
    it('never counts or groups an ICS-214 activity line', () => {
      const s = run({ notes: [note(at(15, 9), { kind: 'activity' }), note(at(15, 10))] })
      expect(s.aar.incidentCount).toBe(1)
      expect(s.aar.appCount).toBe(0)
      expect(s.aar.groups.flatMap((g) => g.notes).length).toBe(1)
    })
    it('keeps only notes made inside a chosen window, but all of them for the whole log', () => {
      const notes = [note(at(14, 9)), note(at(15, 9)), note(at(16, 9))]
      const windowed = run({ notes, window: { from: at(15, 0), to: at(15, 23) } })
      expect(windowed.aar.incidentCount).toBe(1)
      expect(run({ notes, entries: [entry(at(15, 8))] }).aar.incidentCount).toBe(3)
    })
    it('still shows the notes when the window has no entries', () => {
      const s = run({
        notes: [note(at(15, 9))],
        window: { from: at(15, 0), to: at(15, 23) },
      })
      expect(s.totals.entries).toBe(0)
      expect(s.aar.incidentCount).toBe(1)
    })
  })
})
