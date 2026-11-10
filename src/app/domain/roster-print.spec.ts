import type { RangerType } from '../shared/services/ranger.interface'
import { buildRosterPrint, NO_TEAM_LABEL } from './roster-print'

const r = (over: Partial<RangerType>): RangerType => ({
  id: '',
  callsign: '',
  fullName: '',
  phone: '',
  image: '',
  team: '',
  role: '',
  note: '',
  ...over,
})

describe('buildRosterPrint', () => {
  it('is empty for an empty roster', () => {
    expect(buildRosterPrint([])).toEqual([])
  })

  it('groups by team, teams A to Z, with people who have no team last', () => {
    const groups = buildRosterPrint([
      r({ callsign: 'K1', team: 'Zulu' }),
      r({ callsign: 'K2', team: '' }),
      r({ callsign: 'K3', team: 'alpha' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'Zulu', NO_TEAM_LABEL])
    expect(groups[2].team).toBe('')
  })

  it('treats team names that differ only in case or spacing as one team, as first written', () => {
    const groups = buildRosterPrint([
      r({ callsign: 'K1', team: 'Team A' }),
      r({ callsign: 'K2', team: ' team a ' }),
    ])
    expect(groups.length).toBe(1)
    expect(groups[0].label).toBe('Team A')
    expect(groups[0].rows.length).toBe(2)
  })

  it('sorts each team by call sign in natural order, with a missing call sign last', () => {
    const [g] = buildRosterPrint([
      r({ callsign: 'K7VMI-10', fullName: 'C', team: 'T' }),
      r({ callsign: '', fullName: 'Nocall', team: 'T' }),
      r({ callsign: 'K7VMI-2', fullName: 'B', team: 'T' }),
      r({ callsign: 'ab7xy', fullName: 'A', team: 'T' }),
    ])
    expect(g.rows.map((x) => x.name)).toEqual(['A', 'B', 'C', 'Nocall'])
  })

  it('carries call sign, name, role, phone and ID, trimmed', () => {
    const [g] = buildRosterPrint([
      r({
        callsign: ' K1 ',
        fullName: ' Pat ',
        role: 'Net control',
        phone: '555-0100',
        id: ' 42 ',
        team: 'T',
      }),
    ])
    expect(g.rows[0]).toEqual({
      callsign: 'K1',
      name: 'Pat',
      role: 'Net control',
      phone: '555-0100',
      id: '42',
    })
  })
})
