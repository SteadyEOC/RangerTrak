import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

import { OVERDUE_BAND_COUNT, OVERDUE_RED_MULTIPLE, DEFAULT_CHECK_IN_INTERVAL_MIN } from '../../shared/overdue'
import { MissionLocationService, MissionService, RadioLogEntryType } from '../../shared/services'
import { locationMarkerSvg, resolveLocationIcon } from '../../shared/mapping/location-marker'
import { radioLogStatusColor, locationCategoryColor } from '../../shared/mapping/report-marker-status'
import { evidenceMarkerSvg, rangerColorFor, rangerShapeMarkup } from '../../shared/mapping/ranger-marker'

/**
 * 2026-09-30, John: E-152 part 1 - the legend on the printed map sheet. Hidden on screen
 * (see the scss), shown only in print.
 *
 * Nothing here is a typed-in legend. Every row is derived from the same functions and
 * settings the markers themselves use - rangerShapeMarkup()/rangerColorFor() for the ranger
 * symbols, radioLogStatusColor() for the status colours, locationMarkerSvg()/
 * locationCategoryColor() for the places, shared/overdue.ts's own constants for the
 * overdue bands - so a change to any of them changes the legend with no second edit. The
 * map engine passes in the entries it is DRAWING right now (so the All / Just-selected
 * switch is honoured), and its own name, because the two engines genuinely draw different
 * things: Leaflet gives each ranger a shape, route trails and overdue numbers; MapLibre
 * draws colour-only dots and has neither trails nor overdue shading.
 */
@Component({
  selector: 'rangertrak-map-print-legend',
  standalone: true,
  templateUrl: './map-print-legend.component.html',
  styleUrls: ['./map-print-legend.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPrintLegendComponent {
  /** What the engine is drawing now: the All / Just-selected choice already applied. */
  entries = input.required<RadioLogEntryType[]>()
  engine = input.required<'leaflet' | 'maplibre'>()
  /**
   * 2026-09-30, John: E-162 - which optional map layers are switched on: 'usng' (USNG / MGRS
   * grid), 'rings' (range rings), 'hiking' (hiking trails). Leaflet only; MapLibre has none.
   */
  overlays = input<readonly string[]>([])

  private readonly missionService = inject(MissionService)
  private readonly sanitizer = inject(DomSanitizer)
  private readonly locations = toSignal(inject(MissionLocationService).getLocationsObserver(), { initialValue: [] })

  // Same test both engines apply before drawing a marker.
  private readonly drawn = computed(() => this.entries().filter(e => e.location?.lat && e.location?.lng))

  readonly rangers = computed(() => {
    const byKey = new Map<string, { key: string, label: string, count: number }>()
    for (const e of this.drawn()) {
      const key = e.rangerUid || e.callsign  // the key both engines colour and shape by
      const found = byKey.get(key)
      if (found) found.count++
      else byKey.set(key, { key, label: e.callsign?.trim() || 'No callsign', count: 1 })
    }
    return [...byKey.values()]
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
      .map(r => ({ ...r, swatch: this.rangerSwatch(r.key) }))
  })

  /** Only statuses present on the map, in the order the Mission page lists them. */
  readonly statuses = computed(() => {
    const configured = this.missionService.settings.radioLogStatuses
    const present = new Set(this.drawn().map(e => e.status))
    return configured
      .filter(s => present.has(s.status))
      .map(s => ({ label: s.status, color: radioLogStatusColor(s.status, configured) ?? '#888888' }))
  })

  readonly hasEvidence = computed(() => this.drawn().some(e => !!e.evidenceLocation))
  readonly evidenceSwatch = this.trusted(evidenceMarkerSvg())

  /** Leaflet draws a trail for any ranger with two or more reports; MapLibre draws none. */
  readonly hasTrails = computed(() => {
    if (this.engine() !== 'leaflet') return false
    const seen = new Set<string>()
    for (const e of this.drawn()) {
      const key = e.rangerUid || e.callsign
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  })

  /** Overdue shading exists on the Leaflet map only, and only when a check-in interval is set. */
  readonly overdue = computed(() => {
    if (this.engine() !== 'leaflet') return null
    const interval = this.missionService.settings.checkInIntervalMin ?? DEFAULT_CHECK_IN_INTERVAL_MIN
    if (!(interval > 0)) return null
    const step = (OVERDUE_RED_MULTIPLE - 1) / OVERDUE_BAND_COUNT  // as overdueBand() steps it
    const bands = Array.from({ length: OVERDUE_BAND_COUNT }, (_, i) => ({
      band: i + 1,
      fromMin: Math.round(interval * (1 + i * step)),
    }))
    return { interval, bands }
  })

  readonly places = computed(() => {
    const types = this.missionService.settings.locationTypes
    return this.locations().map(loc => ({
      name: loc.name,
      type: loc.type,
      swatch: this.trusted(locationMarkerSvg(
        resolveLocationIcon(loc.type, types), locationCategoryColor(loc.type, types))),
    }))
  })

  // Built only from this app's own marker functions and colour-checked (safeMarkerColor)
  // settings - never free text - so bypassing Angular's sanitizer, which would strip <svg>,
  // is the same trust the map engines already place in these strings.
  private trusted(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg)
  }

  private rangerSwatch(key: string): SafeHtml {
    // Leaflet draws the per-ranger shape; MapLibre's circle layer draws colour only.
    const inner = this.engine() === 'leaflet'
      ? rangerShapeMarkup(key)
      : `<circle cx="10" cy="10" r="8" fill="${rangerColorFor(key)}"/>`
    return this.trusted(`<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" stroke="#555" stroke-width="1" stroke-linejoin="round">${inner}</svg>`)
  }
}
