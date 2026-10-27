import 'leaflet'
import * as L from 'leaflet'
import { forward as mgrsForward } from 'mgrs'
import { DEFAULT_CHECK_IN_INTERVAL_MIN, elapsedMinutes, overdueBand } from '../domain/overdue'
import {
  DDToUTM, DDToUTMInZone, UTMToDD, bearingAndDistance, destinationPoint
} from '../domain/coordinate'
import { rangerColorFor, resolveLocationIcon } from '../shared'
import type { MissionLocationType, MissionType, RadioLogEntryType } from '../shared/services'
import type { WritableSignal } from '@angular/core'

// E-item, raised 2026-08-27 comparing against a real IMT wildfire ops map: a mile grid
// overlay, same as that map's own township/range-style reference lines. A UTM-based grid,
// not a lat/lng graticule - degrees of longitude aren't a fixed distance (they shrink toward
// the poles), so a lat/lng grid can't be spaced in real miles the way this one is. Reuses
// this app's own DDToUTM/UTMToDD (Sprint H) rather than adding a second projection library.
export const MILE_METERS = 1609.344

// E-162 range rings: the round spacings refreshRangeRings() picks from, smallest first.
export const RING_STEPS_MILES = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500]
const MAX_RANGE_RINGS = 25

/** A ring distance as its label reads: "0.25 mi (0.40 km)", "2 mi (3.2 km)". */
export function formatRingMiles(miles: number): string {
  const km = miles * MILE_METERS / 1000
  return `${Math.round(miles * 100) / 100} mi (${km.toFixed(km < 1 ? 2 : 1)} km)`
}

/** What LeafletOverlays needs from the map component (a narrow view, not the component itself). */
export interface LeafletOverlaysHost {
  /** The main Leaflet map (undefined until initMainMap() has built it). */
  map(): L.Map
  settings(): MissionType
  locations(): MissionLocationType[]
  displayedRadioLogEntries(): RadioLogEntryType[]
  /** Which report marker each minutes badge belongs to; owned by the component (markers + print share them). */
  readonly entryMarkers: Map<RadioLogEntryType, L.Marker>
  readonly badgeMarkers: Map<L.Tooltip, L.Marker>
  /** Range ring slider state (module-level signals on the component, so they survive leaving the page). */
  readonly ringStepIndex: WritableSignal<number>
  readonly autoRingMiles: WritableSignal<number | undefined>
}

/**
 * The map's drawn overlays: per-callsign trails, the mile grid, the USNG / MGRS grid and the
 * range rings. Extracted from mapLeaflet.component.ts (architecture pass, D-57) with the code
 * unchanged. A plain class: the component constructs it and owns its lifetime.
 */
export class LeafletOverlays {
  // E-80 phase 1: per-callsign route trails, static (no animation/timer - see the roadmap
  // scoping). A plain layer group, not clustered - clustering exists to collapse crowded
  // point markers and would be actively wrong for line geometry.
  readonly myTrailsLayer = L.layerGroup()
  // Mile grid overlay (see MILE_METERS' own comment) - redrawn on pan/zoom by
  // refreshMileGrid(), only while this layer is actually checked on in the layers control.
  readonly mileGridLayer = L.layerGroup()
  // 2026-09-30, John: E-162 - USNG / MGRS grid overlay; redrawn by refreshUsngGrid() the same way.
  readonly usngGridLayer = L.layerGroup()
  // 2026-09-30, John: E-162 - range rings around the command post; see refreshRangeRings().
  readonly rangeRingsLayer = L.layerGroup()

  constructor(private readonly host: LeafletOverlaysHost) { }

  private get lMap(): L.Map { return this.host.map() }
  private get settings(): MissionType { return this.host.settings() }
  private get locations(): MissionLocationType[] { return this.host.locations() }
  private get displayedRadioLogEntries(): RadioLogEntryType[] { return this.host.displayedRadioLogEntries() }
  private get entryMarkers() { return this.host.entryMarkers }
  private get badgeMarkers() { return this.host.badgeMarkers }
  private get ringStepIndex() { return this.host.ringStepIndex }
  private get autoRingMiles() { return this.host.autoRingMiles }

  /**
   * Redraws the mile grid overlay (see MILE_METERS' own comment) for the current viewport.
   * Clears and rebuilds from scratch rather than diffing - cheap enough at the line counts
   * a capped, zoomed-in-enough grid actually produces (see maxLines below), and far simpler
   * than tracking which lines are still in view across an arbitrary pan/zoom.
   *
   * UTM, not lat/lng: a degree of longitude is not a fixed distance (it shrinks toward the
   * poles), so only a projected system gives lines that are actually 1 mile apart on the
   * ground. Every corner of the viewport is converted using the CENTER's own UTM zone/
   * hemisphere - correct as long as the viewport doesn't itself straddle a zone boundary,
   * which is guaranteed true at every zoom level this draws at (zone boundaries are almost
   * 4° of longitude apart; this grid never draws below zoom 12, well inside a single
   * viewport's-worth of one zone).
   */
  refreshMileGrid(): void {
    this.mileGridLayer.clearLayers()

    const zoom = this.lMap.getZoom()
    if (zoom < 12) {
      // Below this, a 1-mile grid over the visible area would be hundreds of lines -
      // unreadable, and expensive to compute/render for no benefit. Leaflet's scale bar
      // (added above) already covers "how big is this on screen" at wider zooms.
      return
    }

    // A small pad so a line doesn't visibly pop in right at the viewport's edge on pan.
    const bounds = this.lMap.getBounds().pad(0.15)
    const center = bounds.getCenter()
    const { zone, hemisphere } = DDToUTM(center.lat, center.lng)

    const corners = [
      bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast(),
    ].map(c => DDToUTM(c.lat, c.lng))
    const minE = Math.min(...corners.map(c => c.easting))
    const maxE = Math.max(...corners.map(c => c.easting))
    const minN = Math.min(...corners.map(c => c.northing))
    const maxN = Math.max(...corners.map(c => c.northing))

    // Guards against a pathological viewport (e.g. right at a UTM zone edge, where the
    // corners' eastings can disagree wildly) producing an absurd number of lines.
    const maxLines = 60
    const eastLines = Math.floor((maxE - minE) / MILE_METERS) + 1
    const northLines = Math.floor((maxN - minN) / MILE_METERS) + 1
    if (eastLines > maxLines || northLines > maxLines) {
      return
    }

    // Each line is sampled at several points and drawn as a polyline, not a single
    // two-point segment: a constant-easting or constant-northing line in UTM is not
    // perfectly straight in lat/lng (meridian convergence), so a straight two-point chord
    // would visibly drift from the true grid line over a mile-plus span at typical
    // operational zoom levels.
    const STEPS = 6
    const gridStyle: L.PolylineOptions = { color: '#3355ff', weight: 1, opacity: 0.55, interactive: false }

    const startE = Math.ceil(minE / MILE_METERS) * MILE_METERS
    for (let e = startE; e <= maxE; e += MILE_METERS) {
      const pts: L.LatLngExpression[] = []
      for (let i = 0; i <= STEPS; i++) {
        const n = minN + (maxN - minN) * i / STEPS
        const dd = UTMToDD(zone, hemisphere, e, n)
        if (dd) pts.push([dd.lat, dd.lng])
      }
      if (pts.length > 1) {
        this.mileGridLayer.addLayer(L.polyline(pts, gridStyle))
      }
    }

    const startN = Math.ceil(minN / MILE_METERS) * MILE_METERS
    for (let n = startN; n <= maxN; n += MILE_METERS) {
      const pts: L.LatLngExpression[] = []
      for (let i = 0; i <= STEPS; i++) {
        const e = minE + (maxE - minE) * i / STEPS
        const dd = UTMToDD(zone, hemisphere, e, n)
        if (dd) pts.push([dd.lat, dd.lng])
      }
      if (pts.length > 1) {
        this.mileGridLayer.addLayer(L.polyline(pts, gridStyle))
      }
    }
  }

  /**
   * 2026-09-30, John: E-162 - range rings: concentric circles around the command post, each
   * labelled with its distance (miles, with kilometres beside it - the app has no units
   * setting, so both are shown, as the scale bar does). The centre is the first Location
   * whose category resolves to the Command Post icon (the same resolution the map markers
   * use, so a category renamed but given that icon still counts); with none, the mission's
   * default location (defLat/defLng). Computed here, so it works offline. The rings are not
   * interactive, so map clicks pass through.
   *
   * 2026-09-30, John (later): the spacing fits the view, like the scale bar. The first build
   * drew fixed 1, 2 and 5 mile rings, and at the State Fair demo's zoom (the fairground is
   * well under a mile across) every ring was off screen. Now the spacing is a round number
   * (RING_STEPS_MILES) about a sixth of the view's shorter side, so roughly three rings fall
   * between the post and the edge at any zoom: tenths of a mile at a fair, miles for a
   * wilderness search. Saved distances were considered and not built (they'd be a new stored
   * field; John chose zoom-fit). Redrawn on pan/zoom while the layer is on, when it's switched
   * on, and whenever the Locations change (refreshLocationMarkers()).
   */
  refreshRangeRings(): void {
    this.rangeRingsLayer.clearLayers()
    const types = this.settings.locationTypes
    const post = this.locations.find(l => resolveLocationIcon(l.type, types) === 'command-post')
    const lat = post ? post.lat : this.settings.defLat
    const lng = post ? post.lng : this.settings.defLng
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return
    }
    const centre = L.latLng(lat, lng)
    const view = this.lMap.getBounds()
    const viewMeters = Math.min(
      this.lMap.distance(view.getNorthWest(), view.getNorthEast()),
      this.lMap.distance(view.getNorthWest(), view.getSouthWest()))
    const target = viewMeters / 6 / MILE_METERS
    const autoMiles = [...RING_STEPS_MILES].reverse().find(s => s <= target) ?? RING_STEPS_MILES[0]
    this.autoRingMiles.set(autoMiles)
    // A fixed spacing from the slider under the map wins over Auto (see ringStepIndex).
    const stepMiles = this.ringStepIndex() > 0 ? RING_STEPS_MILES[this.ringStepIndex() - 1] : autoMiles
    const step = stepMiles * MILE_METERS

    // Only the rings that can cross the view: from the nearest point of the view (0 when the
    // post is on screen) out to its farthest corner, capped so a post far off screen at a
    // close zoom can't produce thousands of circles.
    const nearest = L.latLng(
      Math.min(Math.max(lat, view.getSouth()), view.getNorth()),
      Math.min(Math.max(lng, view.getWest()), view.getEast()))
    const farthest = Math.max(...[view.getNorthWest(), view.getNorthEast(), view.getSouthWest(), view.getSouthEast()]
      .map(c => this.lMap.distance(centre, c)))
    const first = Math.max(1, Math.floor(this.lMap.distance(centre, nearest) / step))
    const last = Math.min(Math.ceil(farthest / step), first + MAX_RANGE_RINGS - 1)

    // Labels go on the side of each ring facing the middle of the view, so they stay on
    // screen when the post is off to one side; due north when the post is in the middle.
    const toView = bearingAndDistance(lat, lng, view.getCenter().lat, view.getCenter().lng)
    const labelBearing = toView.distanceMeters < step / 2 ? 0 : toView.bearingDegrees

    for (let k = first; k <= last; k++) {
      const meters = k * step
      this.rangeRingsLayer.addLayer(L.circle(centre, {
        radius: meters, color: '#8a3ffc', weight: 1.5, opacity: 0.8, dashArray: '6 4',
        fill: false, interactive: false, className: 'rt-range-ring',
      }))
      const at = destinationPoint(lat, lng, meters, labelBearing)
      this.rangeRingsLayer.addLayer(L.marker([at.lat, at.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: 'rt-range-ring-label', iconSize: [0, 0],
          html: `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;`
            + `font:600 11px/1 sans-serif;color:#6929c4;background:rgba(255,255,255,.85);padding:1px 4px;border-radius:3px">`
            + `${formatRingMiles(k * stepMiles)}</span>`,
        }),
      }))
    }
  }

  /**
   * 2026-09-30, John: E-162 - USNG / MGRS grid overlay. US search and rescue reads positions
   * in USNG (the same grid as MGRS), so this draws the real thing: lines at constant UTM
   * easting/northing, computed on the device with the same UTM helpers the Mile grid uses,
   * so it works with no Internet. Spacing follows the zoom: 100 m lines when zoomed well in,
   * 1 km lines at working zoom, 10 km lines when zoomed out, and nothing below zoom 8 (a
   * grid across a whole region is noise). The 100 km lines are drawn heavier. Each line is
   * labelled, at the viewport edge, with the digits that follow the 100 km square ID in a
   * grid reference (2 digits for 1 km lines: "14" is 14 km), and one label near the top
   * gives the zone and 100 km square ID for the middle of the screen.
   *
   * UTM zone edges: a viewport can straddle one, and grid lines do not carry across (each
   * zone has its own grid). Every zone the viewport touches is drawn in its own projection
   * and each line is cut off at that zone's edge (found by bisection, so the cut is clean),
   * which leaves a thin unlined strip at the boundary rather than lines that shear across
   * it. The 100 km square ID label only follows the zone under the middle of the screen.
   * Not handled: the Norway/Svalbard zone exceptions (outside this app's operating area).
   */
  refreshUsngGrid(): void {
    this.usngGridLayer.clearLayers()
    if (this.lMap.getZoom() < 8) {
      return
    }
    const view = this.lMap.getBounds()
    const pad = view.pad(0.1)
    const south = Math.max(pad.getSouth(), -80)
    const north = Math.min(pad.getNorth(), 84)
    const west = Math.max(pad.getWest(), -180)
    const east = Math.min(pad.getEast(), 179.999)
    if (south >= north || west >= east) {
      return
    }
    const hemisphere = view.getCenter().lat >= 0 ? 'N' : 'S'
    const zoneOf = (lng: number) => Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1))
    const color = '#cc0066'
    type LL = { lat: number, lng: number }

    for (let zone = zoneOf(west); zone <= zoneOf(east); zone++) {
      const zoneLo = (zone - 1) * 6 - 180
      const zoneHi = zone * 6 - 180
      const lo = Math.max(west, zoneLo)
      const hi = Math.min(east, zoneHi)

      // Bounding box of the visible part of this zone, in this zone's UTM: a 3x3 sample
      // rather than 4 corners, since the box edges bow slightly.
      const es: number[] = []
      const ns: number[] = []
      for (let i = 0; i <= 2; i++) {
        for (let j = 0; j <= 2; j++) {
          const p = DDToUTMInZone(south + (north - south) * i / 2, lo + (hi - lo) * j / 2, zone)
          es.push(p.easting)
          ns.push(p.northing)
        }
      }
      const minE = Math.min(...es), maxE = Math.max(...es)
      const minN = Math.min(...ns), maxN = Math.max(...ns)

      // Finest spacing that keeps this zone's line count sane.
      const spacing = [100, 1000, 10000].find(s =>
        (maxE - minE) / s + 1 <= 45 && (maxN - minN) / s + 1 <= 45)
      if (!spacing) {
        continue
      }
      const labelDigits = 5 - Math.log10(spacing)  // 100 m -> 3, 1 km -> 2, 10 km -> 1

      const inside = (p: LL | null): p is LL => !!p && p.lng >= zoneLo && p.lng <= zoneHi
      const trace = (f: (t: number) => LL | null, weight: number) => {
        const style: L.PolylineOptions = { color, weight, opacity: 0.6, interactive: false }
        let seg: L.LatLngExpression[] = []
        const flush = () => {
          if (seg.length > 1) this.usngGridLayer.addLayer(L.polyline(seg, style))
          seg = []
        }
        // The last point still inside the zone between tIn (inside) and tOut (outside).
        const edge = (tIn: number, tOut: number): L.LatLngExpression | null => {
          let a = tIn, b = tOut
          for (let k = 0; k < 7; k++) {
            const m = (a + b) / 2
            if (inside(f(m))) a = m; else b = m
          }
          const p = f(a)
          return inside(p) ? [p.lat, p.lng] : null
        }
        const STEPS = 10
        let prevT = 0
        let prev = f(0)
        if (inside(prev)) seg.push([prev.lat, prev.lng])
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS
          const cur = f(t)
          if (inside(prev) && inside(cur)) {
            seg.push([cur.lat, cur.lng])
          } else if (inside(prev)) {
            const b = edge(prevT, t)
            if (b) seg.push(b)
            flush()
          } else if (inside(cur)) {
            const b = edge(t, prevT)
            seg = b ? [b, [cur.lat, cur.lng]] : [[cur.lat, cur.lng]]
          }
          prev = cur
          prevT = t
        }
        flush()
      }
      const label = (at: LL | null, value: number) => {
        if (!inside(at) || !view.contains([at.lat, at.lng])) return
        const digits = String(Math.floor((value % 100000) / spacing)).padStart(labelDigits, '0')
        this.usngGridLayer.addLayer(L.marker([at.lat, at.lng], {
          interactive: false, keyboard: false,
          icon: L.divIcon({
            className: '', iconSize: [0, 0],
            html: `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;`
              + `font:600 11px/1 sans-serif;color:${color};text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff">${digits}</span>`,
          }),
        }))
      }

      // Where the labels sit: near the bottom edge (for vertical lines) and left edge (for
      // horizontal ones) of what is on screen, in this zone.
      const h = view.getNorth() - view.getSouth()
      const w = view.getEast() - view.getWest()
      const labelLat = view.getSouth() + 0.05 * h
      const labelLng = Math.max(view.getWest(), zoneLo) + 0.04 * w
      const midLat = view.getCenter().lat
      const midLng = Math.min(Math.max(view.getCenter().lng, zoneLo), zoneHi)
      const labelN = DDToUTMInZone(labelLat, midLng, zone).northing
      const labelE = DDToUTMInZone(midLat, labelLng, zone).easting

      for (let e = Math.ceil(minE / spacing) * spacing; e <= maxE; e += spacing) {
        trace(t => UTMToDD(zone, hemisphere, e, minN + (maxN - minN) * t), e % 100000 === 0 ? 2.5 : 1)
        label(UTMToDD(zone, hemisphere, e, labelN), e)
      }
      for (let n = Math.ceil(minN / spacing) * spacing; n <= maxN; n += spacing) {
        trace(t => UTMToDD(zone, hemisphere, minE + (maxE - minE) * t, n), n % 100000 === 0 ? 2.5 : 1)
        label(UTMToDD(zone, hemisphere, labelE, n), n)
      }
    }

    // Zone + 100 km square for the middle of the screen, top centre.
    try {
      const c = view.getCenter()
      const id = mgrsForward([c.lng, c.lat], 0)  // e.g. "10TDT"
      const text = `${id.slice(0, id.length - 2)} ${id.slice(-2)}`
      this.usngGridLayer.addLayer(L.marker([view.getNorth() - 0.05 * (view.getNorth() - view.getSouth()), c.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: '', iconSize: [0, 0],
          html: `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;`
            + `font:700 13px/1 sans-serif;color:${color};background:rgba(255,255,255,.8);padding:2px 6px;border-radius:4px">${text}</span>`,
        }),
      }))
    } catch {
      // Outside MGRS's latitude range (polar): no square ID to show.
    }
  }

  /**
   * E-80 phase 1: static per-callsign route trails, colored by the callsign's current
   * team. Drawn from the same displayedRadioLogEntries markers use, so the all/selected
   * switch and new-report redraws are honored automatically (both call displayMarkers(),
   * which calls this after clearMarkers() has emptied myTrailsLayer).
   *
   * Deliberately still no animation or timer - only the elapsed-time READOUT itself was
   * added back (2026-08-24 follow-on), as a value computed once when this method runs, not
   * a live-updating clock: it goes stale until the next redraw (page load, navigating to
   * /map, or either of this method's own existing redraw triggers - a new report arriving,
   * toggling all/selected), same as everything else this method draws. That distinction is
   * what makes it different from the setInterval-driven readout the original 2026-08-24
   * scoping excluded. Direction is conveyed without a clock: each trail is drawn as N-1
   * separate segments with stepped opacity (oldest faintest, newest strongest) rather than
   * a gradient-along-path, which Leaflet has no native support for.
   */
  drawTrails(withPaths = true) {
    // D-42 phase 5: was grouped by `r.callsign` alone. Two DIFFERENT rangers with no
    // callsign both grouped under the same '' key, so their check-ins could be sorted
    // together into one bogus trail segment connecting two unrelated people. `rangerUid`
    // (the surrogate key, unique per ranger, set even with a blank callsign) takes priority;
    // `callsign` remains the fallback for reports with no `rangerUid` - same key each marker
    // uses (see displayMarkers(), above), so a ranger's trail and marker group identically.
    const byRanger = new Map<string, RadioLogEntryType[]>()
    this.displayedRadioLogEntries.forEach(r => {
      if (!r.location.lat || !r.location.lng) return // same guard displayMarkers() uses
      const key = r.rangerUid || r.callsign
      const group = byRanger.get(key)
      if (group) group.push(r)
      else byRanger.set(key, [r])
    })

    // E-118 (2026-09-22): the staleness badge used to live INSIDE the `< 2` guard below,
    // so a ranger with exactly one check-in - the one most worth flagging, having reported
    // once and then gone silent - got no badge at all. The badge is now drawn for every
    // ranger, and only the polyline still needs two or more points.
    const intervalMin = this.settings?.checkInIntervalMin ?? DEFAULT_CHECK_IN_INTERVAL_MIN

    byRanger.forEach((reports, key) => {
      // Reports aren't guaranteed sorted - the trail is meaningless (and will look
      // plausible while being wrong) if drawn in array order instead of report date.
      const ordered = [...reports].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      // E-97: was teamColorFor(ranger.team) - team is usually blank (E-80 deferred it),
      // so nearly every trail fell through to one grey "unknown" color. rangerColorFor()
      // is the same identity-keyed function the marker fill uses, so a ranger's trail and
      // marker can never show different colors.
      const color = rangerColorFor(key)
      const segmentCount = ordered.length - 1

      // John 2026-10-27: "Latest per ranger" shows one point each, so no path (the badge stays).
      for (let i = 0; withPaths && i < segmentCount; i++) { // no segments at all for a lone check-in
        const opacity = segmentCount === 1 ? 0.9 : 0.25 + (0.65 * i / (segmentCount - 1))
        // 2026-09-30, John: E-163 - trails that show direction. Weight tapers linearly from
        // 1.2 (oldest segment) to 4 (newest): 1.2 + 2.8 * i / (segmentCount - 1) (John 10-27: 20%
        // thinner than the first 1.5 to 5); a lone
        // segment takes the newest weight. Only each ranger's NEWEST segment carries the
        // class that animates a slow dash flow (see .rt-trail-newest in the scss). The
        // polyline is [older, newer], so a decreasing stroke-dashoffset moves the dashes
        // older -> newer. Default SVG renderer (no preferCanvas anywhere), so CSS applies.
        const isNewest = i === segmentCount - 1
        const weight = segmentCount === 1 ? 4 : 1.2 + 2.8 * i / (segmentCount - 1)
        const segment = L.polyline(
          [
            [ordered[i].location.lat, ordered[i].location.lng],
            [ordered[i + 1].location.lat, ordered[i + 1].location.lng]
          ],
          { color, opacity, weight, className: isNewest ? 'rt-trail-newest' : undefined }
        )
        this.myTrailsLayer.addLayer(segment)
      }

      // Elapsed-time follow-on (2026-08-24): a static "minutes since" label at the
      // newest point, computed once here - see the method doc comment above for why this
      // isn't the live clock the original scoping excluded. Redone 2026-08-26: the label
      // is now the bare number (the popup already gives full detail on hover/tap).
      //
      // E-118 (2026-09-22): the band maths moved to domain/overdue.ts and is now measured
      // against the mission's own check-in interval rather than fixed 10-minute steps from
      // 20. The old inline version also disagreed with its own comment - it claimed red at
      // 90+ but the arithmetic reached the top band at 80.
      const newest = ordered[ordered.length - 1]
      const elapsedMin = elapsedMinutes(newest.date)
      const elapsedBand = overdueBand(elapsedMin, intervalMin)
      const label = L.tooltip([newest.location.lat, newest.location.lng], {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: `rt-trail-elapsed rt-trail-elapsed--${elapsedBand}`,
        opacity: 1,
      }).setContent(`${elapsedMin}`)
      this.myTrailsLayer.addLayer(label)
      const newestMarker = this.entryMarkers.get(newest)
      if (newestMarker) {
        this.badgeMarkers.set(label, newestMarker)
      }
    })
  }
}
