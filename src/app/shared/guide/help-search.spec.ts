import { GUIDE_CONTENT } from './guide-content'
import { HELP_INDEX } from './help-index.generated'
import { searchHelp, searchWords, slugForHelp, snippetFor } from './help-search'

describe('help-search (E-264)', () => {
  const search = (q: string) => searchHelp(q, HELP_INDEX, GUIDE_CONTENT)

  it('finds a Help tab section and links to its tab and anchor', () => {
    const hit = search('hand over scribe').find(h => h.helpTab)!
    expect(hit.heading).toBe('Handing a mission to another scribe')
    expect(hit.helpTab).toBe('data')
    expect(hit.anchor).toBe('hand-over')
    expect(hit.where).toBe('Help › Your data')
  })

  it('finds a screen Guide section and names the screen and drawer tab', () => {
    const hit = search('range rings').find(h => h.route === '/map')
    expect(hit).toBeDefined()
    expect(hit!.where).toBe('Map screen')
    expect(hit!.guideTab).toBe('This page')
  })

  it('needs every word, matched at the start of a word', () => {
    expect(search('satellite offline').length).toBeGreaterThan(0)
    expect(search('satellite qqzx')).toEqual([])
    expect(search('qqzx')).toEqual([])
    expect(search('atellite')).toEqual([])
  })

  it('ranks a heading hit above a text-only one', () => {
    expect(search('uninstalling')[0].heading).toBe('Uninstalling RangerTrak')
  })

  it('finds nothing for an empty or one-letter query', () => {
    expect(search('')).toEqual([])
    expect(search('a')).toEqual([])
    expect(searchWords('  Cafe, café  ')).toEqual(['cafe'])
  })

  it('marks the matched words in the snippet', () => {
    const parts = snippetFor('Back up mission on the Mission page.', ['mission'])
    expect(parts.filter(p => p.match).map(p => p.text)).toEqual(['mission', 'Mission'])
    expect(parts.map(p => p.text).join('')).toBe('Back up mission on the Mission page.')
  })

  it('every generated anchor without an id is the slug the Help page looks for', () => {
    for (const e of HELP_INDEX) {
      expect(e.anchor).toMatch(/^[a-z0-9-]+$/)
    }
    expect(slugForHelp('What is a "Ranger"?')).toBe('what-is-a-ranger')
  })
})
