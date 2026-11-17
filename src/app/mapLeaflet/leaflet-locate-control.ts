import * as L from 'leaflet'

/**
 * E-297 (John 11-14): "Go to my location" on the Leaflet maps. One button under the zoom control; a tap asks
 * the browser for this device's position once, pans the view there and shows a dot with its accuracy circle.
 * A second tap while the dot shows takes it away again.
 *
 * It moves the VIEW only. A scribe laptop's own position is often not the incident's (E-114), so this never
 * sets a report's location or a Place. The MapLibre map uses MapLibre's own GeolocateControl for the same job.
 */
export class LocateControl extends L.Control {
  private lMap?: L.Map
  private button?: HTMLAnchorElement
  private status?: HTMLElement
  private here?: L.LayerGroup
  private busy = false

  constructor(position: L.ControlPosition = 'topleft') {
    super({ position })
  }

  override onAdd(map: L.Map): HTMLElement {
    this.lMap = map
    const bar = L.DomUtil.create('div', 'leaflet-bar rt-locate')
    const a = L.DomUtil.create('a', 'rt-locate__btn', bar) as HTMLAnchorElement
    a.href = '#'
    a.setAttribute('role', 'button')
    a.title = 'Go to my location (moves the map only)'
    a.setAttribute('aria-label', 'Go to my location')
    a.dataset['testid'] = 'map-locate'
    a.innerHTML = '<i class="material-icons" aria-hidden="true">my_location</i>'
    this.button = a
    const status = L.DomUtil.create('span', 'rt-locate__status', bar)
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.dataset['testid'] = 'map-locate-status'
    this.status = status

    L.DomEvent.disableClickPropagation(bar)
    L.DomEvent.on(a, 'click', (e: Event) => {
      L.DomEvent.preventDefault(e)
      this.toggle()
    })
    map.on('locationfound', this.onFound, this)
    map.on('locationerror', this.onError, this)
    return bar
  }

  override onRemove(map: L.Map): void {
    map.off('locationfound', this.onFound, this)
    map.off('locationerror', this.onError, this)
    map.stopLocate()
    this.clearDot()
    this.lMap = undefined
  }

  private toggle(): void {
    if (!this.lMap || this.busy) return
    if (this.here) {
      this.clearDot()
      this.say('')
      return
    }
    if (!('geolocation' in navigator)) {
      this.say(locateErrorText(undefined))
      return
    }
    this.busy = true
    this.button?.classList.add('rt-locate__btn--busy')
    this.say('Finding your location…')
    this.lMap.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 15000 })
  }

  private onFound(e: L.LocationEvent): void {
    this.done()
    if (!this.lMap) return
    this.clearDot()
    const group = new L.LayerGroup()
    new L.Circle(e.latlng, { radius: Math.max(e.accuracy, 1), className: 'rt-locate__accuracy', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(group)
    new L.CircleMarker(e.latlng, { radius: 7, className: 'rt-locate__dot', weight: 3, fillOpacity: 1, interactive: false }).addTo(group)
    group.addTo(this.lMap)
    this.here = group
    this.button?.classList.add('rt-locate__btn--on')
    this.say(locateFoundText(e.accuracy))
  }

  private onError(e: L.ErrorEvent): void {
    this.done()
    this.say(locateErrorText(e.code))
  }

  private done(): void {
    this.busy = false
    this.button?.classList.remove('rt-locate__btn--busy')
  }

  private clearDot(): void {
    this.here?.remove()
    this.here = undefined
    this.button?.classList.remove('rt-locate__btn--on')
  }

  private say(text: string): void {
    if (this.status) this.status.textContent = text
  }
}

/** Plain words for the accuracy the browser reported (metres), shown beside the button. */
export function locateFoundText(accuracyM: number): string {
  if (!Number.isFinite(accuracyM) || accuracyM <= 0) return 'You are here'
  if (accuracyM < 1000) return `You are here (within about ${Math.round(accuracyM)} m)`
  return `You are here (within about ${(accuracyM / 1000).toFixed(1)} km: a rough fix)`
}

/**
 * Plain words for a failed lookup. Codes are the Geolocation API's: 1 permission denied, 2 position
 * unavailable, 3 timeout. Undefined = no Geolocation API at all.
 */
export function locateErrorText(code: number | undefined): string {
  switch (code) {
    case 1: return 'Location is blocked for this site. Allow it in the browser\'s site settings to use this button.'
    case 2: return 'This device couldn\'t work out where it is (no GPS or network fix).'
    case 3: return 'Finding your location took too long. Try again, ideally outdoors.'
    default: return 'This browser can\'t share its location.'
  }
}
