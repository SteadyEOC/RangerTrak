import { Injectable, inject, signal } from '@angular/core'

import { defaultCoordinateFormat, type CoordinateFormat } from '../domain/coordinate'
import { MissionService } from '../shared/services/mission.service'
import type { MissionLocationType } from '../shared/services/mission-location.interface'
import type { PlaceBounds } from '../domain/places-file'

export type MapEngine = 'leaflet' | 'maplibre'

/**
 * Holds the user's choice between the two map engines for the current session only - never
 * persisted to storage (E-64 decision: a full reload always returns to the Leaflet default,
 * which is what keeps this pass schema-free - no MissionType field, no migration). A
 * root-provided singleton rather than component state so the choice survives navigating
 * away from /map and back, mirroring Entry's existing "Show all coordinate systems (this
 * session only)" pattern (Sprint H).
 */
@Injectable({ providedIn: 'root' })
export class MapEngineService {
  readonly engine = signal<MapEngine>('leaflet')

  /**
   * What the Leaflet map is showing right now, or null when it is not mounted (MapLibre, or
   * another page). The Map page's Export places card reads it for "Only places in the current
   * map view" (E-187 phase B; offered on Leaflet only, D-56). Written by the Leaflet component on
   * every move, and cleared when it goes away.
   */
  readonly viewBounds = signal<PlaceBounds | null>(null)

  /**
   * The format the Leaflet map's coordinate readout is written in (the same five as Entry). Here
   * rather than in the map component so the Print card's places list can use the same one. Session
   * only: it starts on the mission's default format (E-208) until someone picks another here.
   */
  readonly coordFormat = signal<CoordinateFormat>('DD')
  private coordFormatChosen = false

  /** A person's own pick on the Map page: from now on a mission change no longer moves it. */
  chooseCoordFormat(format: CoordinateFormat): void {
    this.coordFormatChosen = true
    this.coordFormat.set(format)
  }

  constructor() {
    inject(MissionService).getMissionObserver().subscribe(m => {
      if (!this.coordFormatChosen) this.coordFormat.set(defaultCoordinateFormat(m))
    })
  }

  /**
   * E-187 phase D: the Leaflet map's side of "Print places". Set by the Leaflet component while
   * it is mounted (null under MapLibre, D-56). Given the places being printed it frames the map on
   * them, shows only their markers, sizes it for the sheet and waits for its tiles; it returns
   * the function that puts the map back, to call once the print is over.
   */
  readonly placesPrinter = signal<((places: readonly MissionLocationType[]) => Promise<() => void>) | null>(null)

  /**
   * ADR D-49: armed by the Add place button - the NEXT plain map click places a Place there
   * instead of copying coordinates, then disarms. One-shot rather than a persistent mode a scribe
   * could forget is on. Here rather than in either engine because the button lives in the places
   * panel under the map (John, 2026-11-04); each engine reads it, and disarms it when it goes away.
   */
  readonly placingLocation = signal(false)

  setEngine(engine: MapEngine): void {
    this.engine.set(engine)
  }
}
