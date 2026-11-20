import { entryTeam, teamAtSave, teamIsFromRoster } from './entry-team'

const roster = [
  { uid: 'u1', team: 'Team 3' },
  { uid: 'u2', team: '  ' },
]

describe('E-337 entry team', () => {
  it('stamps the From ranger\'s roster team at save', () => {
    expect(teamAtSave('u1', roster)).toBe('Team 3')
  })
  it('leaves the team off for an unknown caller, a blank team, or no ranger', () => {
    expect(teamAtSave('nobody', roster)).toBeUndefined()
    expect(teamAtSave('u2', roster)).toBeUndefined()
    expect(teamAtSave('', roster)).toBeUndefined()
    expect(teamAtSave(undefined, roster)).toBeUndefined()
  })
  it('shows the team recorded at save even after the ranger moved (Q128 a)', () => {
    expect(entryTeam({ team: 'Team 2', rangerUid: 'u1' }, roster)).toBe('Team 2')
    expect(teamIsFromRoster({ team: 'Team 2', rangerUid: 'u1' }, roster)).toBe(false)
  })
  it('falls back to the roster for an entry saved before E-337', () => {
    expect(entryTeam({ rangerUid: 'u1' }, roster)).toBe('Team 3')
    expect(teamIsFromRoster({ rangerUid: 'u1' }, roster)).toBe(true)
    expect(entryTeam({ rangerUid: 'nobody' }, roster)).toBe('')
    expect(teamIsFromRoster({}, roster)).toBe(false)
  })
})
