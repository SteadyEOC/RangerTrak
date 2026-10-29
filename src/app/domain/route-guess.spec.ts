import { guessRoutes, pathWords } from './route-guess'

describe('route-guess (E-256)', () => {
  const first = (path: string) => guessRoutes(path)[0]?.route

  it('finds the page from an old or near name', () => {
    expect(first('/roster')).toBe('/rangers')
    expect(first('/rangres')).toBe('/rangers')
    expect(first('/settings/advanced')).toBe('/mission')
    expect(first('/radiolog')).toBe('/radio-log')
    expect(first('/maps')).toBe('/map')
    expect(first('/faq')).toBe('/help')
    expect(first('/aar')).toBe('/after-action')
  })

  it('reads an encoded path and ignores the query and fragment', () => {
    expect(pathWords('/Radio%20Log?x=1#top')).toEqual(['radio', 'log'])
    expect(first('/Radio%20Log')).toBe('/radio-log')
  })

  it('guesses nothing from nonsense, and never more than asked', () => {
    expect(guessRoutes('/qqzx')).toEqual([])
    expect(guessRoutes('/')).toEqual([])
    expect(guessRoutes('/map-rangers-mission-help', 2).length).toBe(2)
  })

  it('does not throw on a malformed escape', () => {
    expect(() => guessRoutes('/%E0%A4%A')).not.toThrow()
  })
})
