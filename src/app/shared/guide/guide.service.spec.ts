import { GUIDE_CONTENT } from './guide-content'
import { renderGuideText } from './guide-render'
import { GUIDE_ROUTES } from './guide.service'

// The eager route list in guide.service.ts must match the lazily loaded text (E-192).
describe('Guide routes and text', () => {
  it('GUIDE_ROUTES lists exactly the routes that have Guide text', () => {
    expect([...GUIDE_ROUTES].sort()).toEqual(Object.keys(GUIDE_CONTENT).sort())
  })

  it('renderGuideText escapes HTML and links https markers', () => {
    expect(renderGuideText('<b>&')).toBe('&lt;b&gt;&amp;')
    expect(renderGuideText('[x](https://a.b/c)')).toContain('<a href="https://a.b/c"')
  })
})
