import * as L from 'leaflet'

import { ENTRY_LOCATE, LocateControl, locateErrorText, locateFoundText } from './leaflet-locate-control'

describe('LocateControl text (E-297)', () => {
  it('says how close the fix is, in metres or km', () => {
    expect(locateFoundText(12.4)).toBe('You are here (within about 12 m)')
    expect(locateFoundText(2500)).toContain('2.5 km')
    expect(locateFoundText(NaN)).toBe('You are here')
  })

  it('names each Geolocation failure in plain words', () => {
    expect(locateErrorText(1)).toContain('blocked')
    expect(locateErrorText(2)).toContain("couldn't work out")
    expect(locateErrorText(3)).toContain('too long')
    expect(locateErrorText(undefined)).toContain("can't share")
  })
})

describe('LocateControl on a map (E-297)', () => {
  let host: HTMLDivElement
  let map: L.Map

  beforeEach(() => {
    host = document.createElement('div')
    host.style.width = '400px'
    host.style.height = '300px'
    document.body.appendChild(host)
    map = new L.Map(host, { center: [47.4, -122.46], zoom: 12 })
  })

  afterEach(() => {
    map.remove()
    host.remove()
  })

  it('adds one button, and a found location draws a dot without touching anything else', () => {
    new LocateControl().addTo(map)
    const btn = host.querySelector<HTMLAnchorElement>('[data-testid="map-locate"]')
    expect(btn).toBeTruthy()
    expect(btn!.getAttribute('aria-label')).toBe('Go to my location')

    const before = countLayers(map)
    map.fire('locationfound', { latlng: new L.LatLng(47.45, -122.45), accuracy: 30 })
    expect(countLayers(map)).toBeGreaterThan(before)
    expect(btn!.classList).toContain('rt-locate__btn--on')
    expect(host.querySelector('[data-testid="map-locate-status"]')!.textContent).toContain('30 m')
  })

  it("Entry's version (Q117) sits bottom right and says it does not set the report's position; its clicks never reach the map", () => {
    new LocateControl('bottomright', ENTRY_LOCATE).addTo(map)
    const btn = host.querySelector<HTMLAnchorElement>('[data-testid="entry-locate"]')
    expect(btn).toBeTruthy()
    expect(btn!.closest('.leaflet-bottom.leaflet-right')).toBeTruthy()
    expect(btn!.title).toContain('does NOT set')
    expect(host.querySelector('[data-testid="entry-locate-status"]')).toBeTruthy()
    const onHostClick = vi.fn()
    host.addEventListener('click', onHostClick)
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onHostClick).not.toHaveBeenCalled()
  })

  it('reports a refusal in the status line', () => {
    new LocateControl().addTo(map)
    map.fire('locationerror', { code: 1, message: 'denied' })
    expect(host.querySelector('[data-testid="map-locate-status"]')!.textContent).toContain('blocked')
  })
})

function countLayers(map: L.Map): number {
  let n = 0
  map.eachLayer(() => { n++ })
  return n
}
