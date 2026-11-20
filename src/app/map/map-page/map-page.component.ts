import { AsyncPipe, DatePipe, NgComponentOutlet, NgTemplateOutlet } from '@angular/common'
import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, Type, ViewChild, computed, inject, signal
} from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatIconModule } from '@angular/material/icon'

import { LmapComponent } from '../../mapLeaflet/mapLeaflet.component'
import { PageComponent } from '../../shared/page/page.component'
import { MissionService } from '../../shared/services'
import { OperatorNameService } from '../../shared/services/operator-name.service'
import { ViewService } from '../../shared/services/view.service'
import { FullscreenService } from '../../shared/services/fullscreen.service'
import { UsageStateService } from '../../shared/services/usage-state.service'
import { AdvancedDirective } from '../../shared/view/advanced.directive'
import type { ViewContext } from '../../domain/view'
import { MapEngineService } from '../../shared/services/map-engine.service'
import { PlacesIoComponent } from '../places-io/places-io.component'
import { PrintBrandComponent } from '../../shared/print-brand/print-brand.component'
import { MissionJournalService } from '../../shared/services/mission-journal.service'

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
  imports: [PageComponent, LmapComponent, NgComponentOutlet, NgTemplateOutlet, AsyncPipe, DatePipe, MatButtonModule, MatCheckboxModule, MatIconModule, PlacesIoComponent, AdvancedDirective, PrintBrandComponent],
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

  // E-78 / E-315: the Full screen button is one of the header's page tools now (every page has it).
  // This page registers its map area (map + switch + whichever engine is mounted) as the element
  // that fills the screen, so Full screen here behaves as it did when the button sat in the map.
  // While the map area is full screen the header is out of view (and an iPhone has no Esc), so the
  // area carries its own Exit full screen button.
  protected readonly fullscreen = inject(FullscreenService)

  // Prepared by: pre-filled from the Entry page's operator name (in-memory OperatorNameService,
  // never persisted). Once the user types here, their text wins and is never overwritten.
  private readonly operatorName = inject(OperatorNameService)
  readonly journal = inject(MissionJournalService)
  private readonly typedPreparedBy = signal<string | null>(null)
  readonly preparedBy = computed(() => this.typedPreparedBy() ?? this.operatorName.name())
  onPreparedByInput(event: Event): void {
    this.typedPreparedBy.set((event.target as HTMLInputElement).value)
  }

  @ViewChild('fullscreenArea') private set fullscreenArea(el: ElementRef<HTMLElement> | undefined) {
    this.fullscreen.setTarget(el?.nativeElement ?? null)
  }

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

  constructor(private engineService: MapEngineService, private missionService: MissionService, public view: ViewService,
    protected usage: UsageStateService) { }

  /** E-207: the advanced controls on this page that Easy menus can hide. */
  protected readonly advancedIds = ['maplibre', 'places-import'] as const

  /** E-207 / D-62 item 3: the page's own facts for ViewService (the Alternative map is the one showing). */
  mapHere(): Partial<ViewContext> {
    return { mapEngineIsAlternative: this.engineService.engine() === 'maplibre' }
  }

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
    this.fullscreen.setTarget(null)
  }

  private async loadMaplibre(): Promise<void> {
    if (this.maplibreComponentType()) {
      return
    }
    const { MapLibreComponent } = await import('../mapLibre.component')
    this.maplibreComponentType.set(MapLibreComponent)
  }

  async onEngineSwitchChanged(event: { checked: boolean }): Promise<void> {
    const useMaplibre = event.checked

    if (useMaplibre) {
      await this.loadMaplibre()
    }

    this.engineService.setEngine(useMaplibre ? 'maplibre' : 'leaflet')
  }
}
