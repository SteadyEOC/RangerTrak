import { AsyncPipe, DatePipe, NgComponentOutlet, NgTemplateOutlet } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, Type, ViewChild, computed, inject, signal
} from '@angular/core'
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle'

import { LmapComponent } from '../../mapLeaflet/mapLeaflet.component'
import { PageComponent } from '../../shared/page/page.component'
import { MissionService } from '../../shared/services'
import { OperatorNameService } from '../../shared/services/operator-name.service'
import { MapEngineService } from '../map-engine.service'

/**
 * E-64: a thin shell owning route `/map`. It owns ONLY the page wrapper, the engine
 * switch, and mounting exactly one engine at a time - everything else (each engine's own
 * coordinate/zoom readout, overview map, Instructions, All/Selected checkbox) stays inside
 * LmapComponent/MapLibreComponent, per the maintainer's explicit "should not be merged without
 * reason." No shared base class, no changes to either engine's internals.
 *
 * Leaflet is imported eagerly here (it's the hardcoded default - no auto-detection, that
 * mechanism is deferred pending real usage). MapLibre is `await import()`ed only when the
 * switch is actually flipped, so a visitor who never touches it never downloads its ~966KB
 * chunk - this is the entire reason a route-level shell exists rather than statically
 * importing both engines into one component.
 */
@Component({
  selector: 'rangertrak-map-page',
  standalone: true,
  imports: [PageComponent, LmapComponent, NgComponentOutlet, NgTemplateOutlet, AsyncPipe, DatePipe, MatSlideToggleModule],
  templateUrl: './map-page.component.html',
  styleUrls: ['./map-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MapPageComponent implements OnInit, OnDestroy {
  // D-31: "the primary takes the plain name" - now the only nav item, so no scribe-facing
  // reason to distinguish it from either engine by name.
  title = 'Map'
  pageDescr = 'Leaflet is shown by default. Use the switch below to try the MapLibre + PMTiles alternative engine.'

  // MapLibre's component class, once dynamically imported. null until loaded - stays
  // cached afterward so flipping back and forth doesn't re-fetch the module (the browser's
  // own module cache would dedupe this anyway, but avoiding a repeat dynamic import() call
  // keeps the loading logic simple either way).
  maplibreComponentType = signal<Type<unknown> | null>(null)

  // E-78: one control in the shared shell rather than one per engine - it targets this
  // page's own wrapper div (map + switch + whichever engine is mounted), not either
  // engine's internals, so it works identically for both without touching LmapComponent or
  // MapLibreComponent (keeps E-64's "should not be merged without reason" intact). Native
  // Fullscreen API rather than a plugin (leaflet.fullscreen has no MapLibre equivalent, and
  // this app already avoids a per-engine control here for the same reason it avoids one for
  // the engine switch itself). Verified live that neither engine needs a manual resize
  // nudge: Leaflet's default `trackResize` listens for the window resize event fullscreen
  // entry/exit fires, and MapLibre's container uses a ResizeObserver - both pick up the new
  // size on their own.
  isFullscreen = signal(false)

  // Prepared by: pre-filled from the Entry page's operator name (in-memory OperatorNameService,
  // never persisted). Once the user types here, their text wins and is never overwritten.
  private readonly operatorName = inject(OperatorNameService)
  private readonly typedPreparedBy = signal<string | null>(null)
  readonly preparedBy = computed(() => this.typedPreparedBy() ?? this.operatorName.name())
  onPreparedByInput(event: Event): void {
    this.typedPreparedBy.set((event.target as HTMLInputElement).value)
  }

  @ViewChild('fullscreenArea') private fullscreenArea!: ElementRef<HTMLElement>

  // E-item 13 (2026-08-27), raised comparing against a real IMT wildfire ops map: a
  // print-only header showing the mission name and a timestamp, same as that map's own
  // title block ("Sinlahekin / WA-NES-001791 / 2026/08/01"). mission$ over a signal here
  // since this is read once, in the template, purely for display - no need for the extra
  // machinery a subscribe()/signal pair would add for a value nothing else in this
  // component reacts to. printedAt is captured on the browser's own `beforeprint` event,
  // not page-load time, so a map printed an hour after it was opened shows when it was
  // actually printed, not when the route was first visited.
  readonly mission$ = this.missionService.getMissionObserver()
  printedAt = signal(new Date())
  private readonly onBeforePrint = () => this.printedAt.set(new Date())

  constructor(private engineService: MapEngineService, private missionService: MissionService) { }

  get engine() {
    return this.engineService.engine
  }

  // E-77 (found 2026-08-25): MapEngineService.engine is a root singleton that deliberately
  // survives navigating away from /map and back (see that service's own doc comment) - but
  // this component, and therefore maplibreComponentType, is recreated fresh on every visit
  // to the route. A returning visit with 'maplibre' already selected landed on neither
  // branch of the template's @if/@else if: engine() wasn't 'leaflet', and
  // maplibreComponentType() was null again because nothing had re-triggered the dynamic
  // import for this new instance - the switch showed checked over an empty page. Loading
  // MapLibre here, whenever a fresh instance finds the engine already set to it, closes
  // that gap without touching the switch's own behavior.
  ngOnInit(): void {
    if (this.engine() === 'maplibre') {
      this.loadMaplibre()
    }
    window.addEventListener('beforeprint', this.onBeforePrint)
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeprint', this.onBeforePrint)
  }

  private async loadMaplibre(): Promise<void> {
    if (this.maplibreComponentType()) {
      return
    }
    const { MapLibreComponent } = await import('../mapLibre.component')
    this.maplibreComponentType.set(MapLibreComponent)
  }

  async onEngineSwitchChanged(event: MatSlideToggleChange): Promise<void> {
    const useMaplibre = event.checked

    if (useMaplibre) {
      await this.loadMaplibre()
    }

    this.engineService.setEngine(useMaplibre ? 'maplibre' : 'leaflet')
  }

  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await this.fullscreenArea.nativeElement.requestFullscreen()
    }
  }

  // Keyed off the document's own state, not the click handler, so it also catches the
  // browser's native exit paths (Esc key, the browser's own "exit full screen" affordance).
  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(document.fullscreenElement === this.fullscreenArea?.nativeElement)
  }
}
