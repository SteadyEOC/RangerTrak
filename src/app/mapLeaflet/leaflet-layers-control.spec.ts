import * as L from 'leaflet'

import { RtLayersControl } from './leaflet-layers-control'

describe('RtLayersControl (Leaflet 2.0.0-beta.5 deferred list)', () => {
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

  const rows = (c: L.Control) => [...c.getContainer()!.querySelectorAll('label')].map(l => (l.textContent ?? '').trim())

  it('has its rows in the page while collapsed, as before beta.5', () => {
    const base = { A: new L.LayerGroup(), B: new L.LayerGroup() }
    const control = new RtLayersControl(base, { Grid: new L.LayerGroup() }).addTo(map)
    expect(rows(control)).toEqual(['A', 'B', 'Grid'])
    expect(control.getContainer()!.classList.contains('leaflet-control-layers-expanded')).toBe(false)
  })

  it('runs onExpand after the list is rebuilt, so row styling survives', () => {
    const grid = new L.LayerGroup()
    const control = new RtLayersControl({ A: new L.LayerGroup() }, { Grid: grid }).addTo(map)
    const hide = () => control.getContainer()!.querySelectorAll('label').forEach(l => { l.style.display = 'none' })
    control.onExpand = hide
    hide()
    grid.addTo(map) // collapsed: beta.5 marks the list stale instead of rebuilding
    control.expand() // rebuilds the rows, then onExpand hides them again
    const labels = [...control.getContainer()!.querySelectorAll('label')]
    expect(labels.length).toBe(2)
    expect(labels.every(l => l.style.display === 'none')).toBe(true)
  })

  it('keeps a configured collapseDelay', () => {
    const control = new RtLayersControl({}, {}, { collapseDelay: 300 }).addTo(map)
    expect(control.options.collapseDelay).toBe(300)
  })
})
