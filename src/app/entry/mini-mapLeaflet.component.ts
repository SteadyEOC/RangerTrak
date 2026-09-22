// Leaflet must be *evaluated* before leaflet.markercluster: the plugin is old-style and
// reads the global `L` at module-evaluation time ("L is not defined" otherwise). This bare
// side-effect import guarantees that, and sorts ahead of the plugin alphabetically so
// import-sort cannot undo it. It used to work only by accident, via the eager
// `import L from 'leaflet'` that RadioLogService no longer has.
import 'leaflet'
import 'leaflet.markercluster'
import { tileLayerOffline } from 'leaflet.offline' // https://github.com/allartk/leaflet.offline
//import { markerClusterGroup } from 'leaflet'
import * as L from 'leaflet'
import { removeLeafletMap } from '../shared/mapping/leaflet-teardown'

//import pc from 'picocolors' // https://github.com/alexeyraspopov/picocolors
import { delay, throwError } from 'rxjs'

import { CommonModule, DOCUMENT } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit, Component, ElementRef, EventEmitter, Inject, Input, OnDestroy, OnInit, Output,
  signal, ViewChild, ChangeDetectionStrategy
} from '@angular/core'

// Specific paths, not the '../shared/' barrel: the barrel re-exports the MapLibre style
// helpers, so importing through it here pulled MapLibre (~800KB) into the eager bundle
// alongside Leaflet, even though this Leaflet mini-map never touches MapLibre.
import { AbstractMap } from '../shared/mapping/map'
import { evidenceIconFor, rangerIconFor } from '../shared/mapping/ranger-icon'
import { formatReportTime } from '../shared/mapping/report-time'
import { Utility } from '../shared/utility'
import {
  RadioLogService, LocationType, LogService, MissionService, undefinedAddressFlag,
  undefinedLocation
} from '../shared/services'

const iconRetinaUrl = 'assets/icons/marker-icon-2x.png'
const iconUrl = 'assets/icons/marker-icon.png'
const shadowUrl = 'assets/icons/marker-shadow.png'
const iconDefault = L.icon({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
})
const markerIcon = L.icon({
  iconSize: [20, 25],
  iconUrl: '../../assets/icons/marker-icon.png',
  shadowUrl: '../../assets/icons/marker-shadow.png'
})
L.Marker.prototype.options.icon = iconDefault;
//or L.Marker.prototype.options.icon = new L.Icon.Default;
//type LatLng = { lat: number, lng: number }


@Component({
  selector: 'mini-mapLeaflet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mini-mapLeaflet.component.html',
  styleUrls: ['./mini-mapLeaflet.component.scss',
    '../../../node_modules/leaflet/dist/leaflet.css'], // only seems to work when embedded in angular.json & Here! (chgs there REQUIRE restart!)]
  changeDetection: ChangeDetectionStrategy.Eager,
  // Deliberately NOT providing MissionService: it is providedIn:'root' and a second
  // instance here would diverge from everyone else's. See BUG-2 in entry.component.ts.
})
export class MiniMapLeafletComponent extends AbstractMap implements OnInit, AfterViewInit, OnDestroy {

  _location = undefinedLocation
  // Use setter get notification of new locations from parent entry form (pg 182 & 188)
  @Input() set locationUpdated(newLocation: LocationType) {
    // Normal data flow from the parent Entry form, not a fault - see the equivalent
    // comment in mission.service.ts about keeping the Log page's errors meaningful.
    // Fires on EVERY coordinate/address edit on Entry's hot path (log-noise audit,
    // 2026-08-31) - the two trace lines this setter and addMarker() below used to log on
    // every single one were removed for the same reason location.component.ts's own
    // per-keystroke DD/DDM/DMS/MGRS/UTM traces were: no ongoing debugging value, real cost
    // in ring-buffer space that could instead hold actual field activity.

    if (newLocation && (newLocation.lat != undefined)) {
      // All we need to display is lat & long: address is superfluious, just used for the title
      this._location = newLocation

      if (!this.lMap) {
        // Expected: an @Input setter runs before ngOnInit, which is where the map
        // is created. Stash the location and stop - the tail of ngOnInit replays
        // it onto the map. Calling addMarker() here anyway is what produced the
        // "addMarker(): bad lat ... mapLeaflet: undefined" error on every Entry load.
        this.log.verbose(`Location arrived before the map was built; ngOnInit will place it.`, this.id)
        return
      }
      this.addMarker(newLocation.lat, newLocation.lng, newLocation.address)
      //  ! this.onNewLocation(newLocation)
    } else {
      this.log.error((`DRATS: Parent sent undefined location event to child`), this.id)
    }
  }
  get locationUpdated(): LocationType {
    return this._location
  }

  // Architecture decision, 2026-08-26: the optional evidence/clue marker
  // (evidence-location.component.ts computes it, entry.component.ts passes it through).
  // Tracked and added to `this.lMap` DIRECTLY, never through `myMarkerCluster` -
  // addMarker() (below) calls `clearMarkers()` on every reporter-position update, which
  // would otherwise wipe this marker every time the crosshair moves, not just when the
  // scribe actually clears the evidence section.
  private evidenceMarker?: L.Marker

  @Input() set evidenceLocationUpdated(newLocation: LocationType | null) {
    if (!this.lMap) {
      // Same "arrived before the map was built" case locationUpdated's own setter guards -
      // ngOnInit's initial placement pass (below) re-reads the current @Input value once
      // the map exists, so nothing is lost by returning here.
      return
    }
    if (!newLocation) {
      this.evidenceMarker?.remove()
      this.evidenceMarker = undefined
      return
    }
    if (this.evidenceMarker) {
      this.evidenceMarker.setLatLng([newLocation.lat, newLocation.lng])
    } else {
      // See evidenceIconFor()'s own doc comment (shared/mapping/ranger-icon.ts) for why this
      // is a distinct shared icon rather than something drawn inline here.
      this.evidenceMarker = L.marker([newLocation.lat, newLocation.lng], {
        icon: evidenceIconFor(), title: 'Evidence/clue location'
      })
      this.evidenceMarker.addTo(this.lMap)
    }
  }

  // E-46: the missing half of the mediator pattern location.component.ts already has
  // (@Input location / @Output locationChange). Before this, clicking the mini-map only
  // ever wrote to the clipboard - there was no channel to report the click back up to
  // the parent Entry form, so the marker didn't move and the Where fields didn't update.
  @Output() locationChange = new EventEmitter<LocationType>()

  // E-105 (2026-08-27): Alt+click marks the EVIDENCE location instead of moving the
  // reporter's own position - a scribe places a marker directly at the clue rather than
  // estimating a distance/bearing by eye. A modifier key, not a second click target,
  // because there's only one map and "click" already means "this is where I am."
  @Output() evidenceLocationClicked = new EventEmitter<{ lat: number, lng: number }>()

  // Replaces a direct `document.getElementById('Entry__LMinimap-status').innerText =`
  // write (the pre-Sprint-G pattern) - see clickStatus below and the template binding.
  clickStatus = signal('Click map to copy coordinates')
  @ViewChild('statusEl') private statusEl!: ElementRef<HTMLDivElement>

  override id = 'Leaflet MiniMap Component'
  override title = 'Leaflet MiniMap'

  // static: true - the div is unconditional in the template, and the map is built in
  // ngOnInit. Resolved from this component's own view, not by DOM id: Leaflet resolves a
  // string container globally, and this minimap shared id="map" with two full-page maps,
  // so navigating Entry -> /mapLeaflet handed Leaflet *this* element. See D-30.
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>

  private lMap!: L.Map
  private overviewMapLeaflet!: L.Map

  // TODO: Leaflet's version of following?
  overviewMapLeafletType = { cur: 0, types: { type: ['roadmap', 'terrain', 'satellite', 'hybrid',] } }

  myMarkerCluster = new window.L.MarkerClusterGroup()
  //myMarkers: L.Marker[] = []
  mapOptions = ""

  //markerClusterGroup_UNUSED: L.MarkerClusterGroup // MarkerClusterGroup extends FeatureGroup, retaining it's methods, e.g., clearLayers() & removeLayers()
  // markerClusterData = []

  constructor(
    missionService: MissionService,
    radioLogService: RadioLogService,
    httpClient: HttpClient,
    log: LogService,
    @Inject(DOCUMENT) protected override document: Document
  ) {
    super(missionService,
      radioLogService,
      httpClient,
      log,
      document)

    this.log.verbose(`======== Constructor() ============, using https://www.LeafletJS.com version ${L.version}`, this.id)

    this.hasOverviewMap = false
    this.displayReports = true  //! Hides ALL markers, not just all reports???
    this.hasSelectedReports = false
    // per https://stackoverflow.com/a/71574063/18004414 & https://github.com/Leaflet/Leaflet/issues/8451
    this.myMarkerCluster = new window.L.MarkerClusterGroup()
  }

  // override ngOnInit() {
  //   super.ngOnInit()
  //   this.log.excessive("ngOnInit()", this.id)
  // }

  override ngOnInit() {
    super.ngOnInit()
    this.log.excessive("ngOnInit()", this.id)

    if (!this.settings) {
      this.log.error(`ngOnInit - Settings have yet to be read!`, this.id)
    }

    // let i = 0
    // let msMaxDelay = 5000
    // while (!this.settings) {
    //   setTimeout(() => {
    //     this.log.error(`ngOnInit - Settings have yet to be read! Delayed ${i / 10 * msMaxDelay} ms. Retrying.`, this.id)
    //     //this.logPanel = this.document.getElementById("log")
    //   }, msMaxDelay / 10)
    //   if (++i > 9) {
    //     return
    //   }
    // }

    if (this.settings?.debugMode) {
      Utility.displayShow(this.document.getElementById("Entry__LMinimap-debug")!)
    } else {

    }

    // Following moved from InitMainMap to avoid: map not a leaflet or google map
    // Set intial map position, though AddMarker rescales/centers map as needed
    this.lMap = L.map(this.mapContainer.nativeElement, {
      center: [this.settings ? this.settings.defLat : 0, this.settings ? this.settings.defLng : 0],
      zoom: this.settings ? this.settings.leaflet.defZoom : 15,
      // ROOT-CAUSED 2026-08-30 (live phone-width e2e failure): Leaflet's CSS3 zoom-animation
      // machinery creates a .leaflet-proxy helper element and drives it with a transform
      // scale computed as 2^(toZoom - fromZoom). Something here triggers that BEFORE the
      // map's internal _zoom is ever set (this mini-map mounts behind an @defer, in a
      // container Angular hasn't necessarily laid out yet), so fromZoom reads as 0 against
      // a real zoom around 14-15 - a 2^14 scale, confirmed live via tools/e2e.js's own
      // overflow-culprit diagnostic (matrix(16384,...)). That proxy's transform inflated
      // document.documentElement.scrollWidth on a phone viewport, and neither
      // overflow:hidden nor CSS containment (contain: layout) on any ancestor (both tried,
      // see .mapLeaflet-container's own comment in mini-mapLeaflet.component.scss) stopped
      // it - a genuine browser gap, not a spec-following ancestor's fault to fix. Disabling
      // the animation entirely removes the whole code path (and the proxy element) rather
      // than trying to contain its output - a small preview map has no real need for the
      // zoom transition's visual polish anyway.
      zoomAnimation: false
    }) // Default view set at map creation

    if (!this.lMap) {
      this.log.error(`this.lMap not created!`, this.id)
      return
    }

    this.initMainMap()
    this.updateRadioLog()

    // We probably got (& stored) an initial location before the map existed, so place it now.
    // Tested against _location, not AbstractMap's `location`: the setter above writes
    // _location and nothing ever assigns `location`, so this compared undefined to
    // undefinedLocation, took the else branch on a fresh page, and called addMarker with
    // the (-1, -1) sentinel - the second source of "addMarker(): bad lat" on Entry.
    if (this._location === undefinedLocation || this._location.address === undefinedAddressFlag) {
      this.log.verbose("No location entered yet at end of ngOnInit() - nothing to mark.", this.id)
    } else {
      this.addMarker(this._location.lat, this._location.lng, this._location.address)
    }

    this.log.excessive("exiting ngOnInit() ...", this.id)
  }

  /**
   * Called once all HTML elements have been created
   */
  ngAfterViewInit() {

  }

  override initMainMap() {
    //!Gets: Leaflet MiniMap Component: InitMap(): map not a leaflet or google map - ignoring as uninitialized?  i.e., this.map is NOT yet an instance of MapLeaflet...
    // ! REVIEW: Does this make a copy (that devolves) or a reference (always in sync)
    this.map = this.lMap
    super.initMainMap()

    this.log.excessive("initMap()", this.id)

    // ! Repeat of the guards in super:
    if (!this.settings) {
      this.log.error(`Settings not yet initialized while initializing the Leaflet Map!`, this.id)
      return
    }

    if (this.displayReports && !this.radioLog) { //! or displayedRadioLogEntries
      this.log.error(`radioLog not yet initialized while initializing the Leaflet Map!`, this.id)
      return
    }


    // ---------------- Init Map -----------------


    // map can be either Leaflet or Google Map (in the abstract class) -
    // But we know it is JUST Leaflet map in this file!
    // Doing this avoids lots of type guards/hassles.


    // F29-6 (2026-08-29): OpenTopoMap, not plain OSM, so this preview shows real contour
    // lines by default - baked directly into OpenTopoMap's own tile rendering, same source
    // LmapComponent's "OpenTopoMap (contours)" base layer already uses. tileLayerOffline
    // still shares its IndexedDB tile cache with LmapComponent's - tiles saved via the full
    // map's "Save this area for offline use" control render here too, offline, PROVIDED the
    // full map had OpenTopoMap selected when Save was pressed (the full map's own
    // baselayerchange handler now rebinds that control to whichever base is active, so this
    // is a real path, not a dead end). maxZoom 17 matches OpenTopoMap's own published tile-
    // generation limit (21 was fine for OSM, but asking OpenTopoMap past 17 returns blank
    // tiles) - a scribe zooming this preview in past that sees the last available level held
    // at its native resolution, same behavior LmapComponent's own OpenTopoMap layer already
    // has. No save control here though; that's the full map's job, not this small preview's.
    const tiles = tileLayerOffline('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      minZoom: 3,
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    })

    // F29-6: terrain relief shading, on by default (unlike the full map's own equivalent
    // overlay, which stays opt-in behind its layer-control checkbox) - this preview has no
    // controls at all, so "on by default" is the only way to offer it here. Same Esri
    // World_Hillshade source and 50% opacity as LmapComponent's hillshadeOverlay, so the two
    // previews of the same spot look consistent. A plain L.tileLayer, not tileLayerOffline:
    // advisory shading laid over the base map, not a navigation layer of its own, so it sits
    // outside the offline-caching story above (same reasoning as the full map's copy).
    const hillshadeOverlay = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16, minZoom: 3, opacity: 0.5,
        attribution: 'Hillshade: &copy; <a href="https://www.esri.com">Esri</a>',
      }
    )

    // TODO: Consider allowing addition of SVG overlay (of known trails and other overlays): https://leafletjs.com/reference.html#svgoverlay
    /*
      var svgElement = document.createElementNS("https://www.w3.org/2000/svg", "svg");
      svgElement.setAttribute('xmlns', "https://www.w3.org/2000/svg");
      svgElement.setAttribute('viewBox', "0 0 200 200");
      svgElement.innerHTML = '<rect width="200" height="200"/><rect x="75" y="23" width="50" height="50" style="fill:red"/><rect x="75" y="123" width="50" height="50" style="fill:#0013ff"/>';
      var svgElementBounds = [ [ 32, -130 ], [ 13, -100 ] ];
      L.svgOverlay(svgElement, svgElementBounds).addTo(map);
    */

    tiles.addTo(this.lMap)
    hillshadeOverlay.addTo(this.lMap)
    // !debugger
    if (this.displayReports && this.radioLog) {
      // ! REVIEW: need to see which way switch is set and maybe set: displayedRadioLogEntries 1st....
      // maybe do this further down?!
      this.displayMarkers()
      const b = this.radioLog.bounds
      // bounds is stored as a plain, serializable BoundsType - Leaflet takes [SW, NE]
      this.lMap.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]))
    } else {
      this.log.error(`initMainMap() did not have displayReports or radioLog!`, this.id)
    }

    L.DomUtil.addClass(this.lMap.getContainer(), 'crosshair-cursor-enabled')  //  Enable crosshairs

    this.lMap.on('zoomend', (ev: L.LeafletEvent) => { //: MouseEvent  :PointerEvent //HTMLDivElement L.LeafletEvent L.LeafletMouseEvent
      if (this.lMap) {
        let z = this.lMap.getZoom()
        if (z === undefined) {
          z = this.settings.leaflet.defZoom
        }
        this.zoom.set(z)
      }
    })

    if (this.hasOverviewMap) {
      this.initOverviewMap()

      this.lMap.on("move", () => {
        if (this.overviewMapLeaflet instanceof L.Map) {
          this.overviewMapLeaflet.setView(this.lMap.getCenter()!,
            this.clamp(
              this.lMap.getZoom() -
              (this.settings.leaflet.overviewDifference),
              (this.settings.leaflet.overviewMinZoom),
              (this.settings.leaflet.overviewMaxZoom)
            ))
        }
      })
    }

    this.captureLMoveAndZoom(this.lMap)
  }

  forceMarker() {
    const myLocation = {
      lat: 47.43,
      lng: -122.45,
      address: "ThisMustWork Road, Pluto",
      derivedFromAddress: false
    }

    this.addMarker(myLocation.lat, myLocation.lng, myLocation.address)
    this.addCircle(myLocation.lat + 0.002, myLocation.lng + 0.002, myLocation.address)
  }

  /**
   *   ---------------- Init OverView Map -----------------
   *
   */
  // Unreachable: the constructor sets hasOverviewMap = false and this template has no
  // overview div, so the L.map('overview') below is the one global-id lookup left in the
  // app. Left as-is rather than converted, because there is no element to convert it to -
  // if this is ever switched on, add a #overviewContainer div and a ViewChild for it.
  initOverviewMap() {
    //! No super.initOverviewMap(), correct?!

    // TODO: Add a light grey rectangle on overview map to show extend/bounods of main map

    // instantiate the overview map without controls
    // https://leafletjs.com/reference.html#map-example
    this.overviewMapLeaflet = L.map('overview', {
      center: [this.settings.defLat, this.settings.defLng],
      zoom: this.settings.leaflet.defZoom,
      zoomControl: false,
      keyboard: false,
      scrollWheelZoom: false,
      dragging: false,
    })

    this.overviewMap = this.overviewMapLeaflet

    const overviewTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: this.settings.leaflet.overviewMaxZoom,
      minZoom: this.settings.leaflet.overviewMinZoom,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    })

    overviewTiles.addTo(this.overviewMapLeaflet)

    // if (this.overviewMapLeaflet === null || this.overviewMapLeaflet === undefined) {
    //   this.log.error(`Could not create overview map!`, this.id)
    //   return
    // }
    // if (this.lMap == null || this.lMap == undefined) {
    //   this.log.error(`map doesn't exist when creating overview map!`, this.id)
    //   return
    // }

    // TODO: Switch map type on click on the overview map
    /* this.overviewMapLeaflet.addListener("click", () => {
      let mapId = this.overviewMapType.cur++ % 4
      this.overviewMapLeaflet.setMapTypeId(this.overviewMapType.types.type[mapId])
      this.log.verbose(`Overview map set to ${this.overviewMapType.types.type[mapId]}`, this.id)
    })*/

    // const infowindow = new google.maps.InfoWindow({
    //   content: "Mouse location...",
    //   position: { lat: this.settings.defLat, lng: this.settings.defLng },
    // })
    //infowindow.open(this.overviewMapLeaflet);

    this.captureLMoveAndZoom(this.overviewMapLeaflet)

    // this.overviewMapLeaflet.on("bounds_changed", () => {
    //   this.overviewMapLeaflet!.setView(this.lMap.getCenter(), this.clamp(
    //     this.lMap!.getZoom()! - (this.settings.leaflet.overviewDifference),
    //     (this.settings.leaflet.overviewMaxZoom),
    //     (this.settings.leaflet.overviewMinZoom)
    //   ))
    // })
  }

  /**
   *
   * @param ev
   */
  onMapReady(ev: any) {
    this.log.verbose(`OnMapReady()`, this.id)
  }

  /**
   * Move the marker to the clicked position, emit it to the parent Entry form (which
   * feeds it into the same Where fields a typed-in coordinate would), and copy it to
   * the clipboard as a convenience.
   * @param ev
   */
  override onMouseClick(ev: MouseEvent) {
    if (!this.lMap) {
      this.log.error(`Leaflet map not created, so can't get lat & lng`, this.id)
      return
    }
    let latlng = this.lMap.mouseEventToLatLng(ev)
    const lat = Math.round(latlng.lat * 10000) / 10000
    const lng = Math.round(latlng.lng * 10000) / 10000
    let coords = `${lat}, ${lng}`

    // E-105: Alt+click marks evidence instead - moving the reporter's own position AND
    // marking evidence off the same click would put a scribe's own marker at the clue by
    // accident whenever they meant only one of the two.
    if (ev.altKey) {
      this.evidenceLocationClicked.emit({ lat, lng })
      return
    }

    this.addMarker(lat, lng, coords)
    this.locationChange.emit({
      lat,
      lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    })

    navigator.clipboard.writeText(coords)
      .then(() => {
        this.clickStatus.set(`${coords} copied to clipboard`)
        if (this.statusEl) {
          Utility.resetMaterialFadeAnimation(this.statusEl.nativeElement)
        } else {
          this.log.info(`statusEl not found!`, this.id)
        }
        this.log.excessive(`${coords} copied to clipboard`, this.id)
      })
      .catch(err => {
        this.log.error(`latlng NOT copied to clipboard, error: ${err}`, this.id)
      })
  }

  override refreshMap() {
    // Try map.remove(); before you try to reload the map. This removes the previous map element using Leaflet's library
    if (this.lMap) {
      this.lMap.invalidateSize() // https://github.com/Leaflet/Leaflet/issues/690
      //or
      // this.lMap.off()
      // this.lMap.remove() // removing ALSO destroys the div id reference, so then rebuild the map div
      // this.initMap() // ?????????? Need testing!!!!
      // or
      /*
      for (i=0;i<points.length;i++) {
        map.removeLayer(points[i]);
      }
      points=[];
      */
      // or
      /* for angular: https://stackoverflow.com/a/50386028/18004414
        $scope.$on('$locationChangeStart', function( event ) {
          if(map != undefined)
          {
            map.remove();
            map = undefined
            document.getElementById('mapLayer').innerHTML = "";
          }
      });
      Without document.getElementById('mapLayer').innerHTML = "" the map was not displayed on the next page.

      This helped me. I am using Angular 6 and changing the map depending on locations the user clicks on. I just have a method to create a new map which return the map object. When I update the map, I pass the existing map object in and do the above without the innerHTML part.
      */
      //or tiles.redraw();
    }
  }


  // ------------------------------------  Markers  ---------------------------------------

  override displayMarkers() {
    super.displayMarkers()

    // REVIEW: wipes out any manually dropped markers. Could save 'em, but no request for that...
    //! This needs to be rerun & ONLY display selected rows/markers: i.e., to use  displayedRadioLogEntries
    if (!this.displayedRadioLogEntries) {
      this.log.error(`displayMarkers did not find field reports to display`, this.id)
      //return
    }
    this.log.verbose(`displayMarkers: all ${this.displayedRadioLogEntries.length} of 'em`, this.id)
    this.displayedRadioLogEntries.forEach(i => {
      if (i.location.lat && i.location.lng) {  // TODO: Do this in the FieldReports Service - or also the GMap; thewse only happened when location was broken???
        let title = `${i.callsign} at ${formatReportTime(i.date)} with ${i.status}`
        //this.log.excessive(`displayMarkers: ${i}: ${JSON.stringify(i)}`, this.id)

        // E-86 (narrowed): a distinct shape+color per ranger callsign, team ignored for now.
        // NOT given the status halo the main map's markers got (2026-08-26) - this mini-map
        // is deliberately minimal by design (a crosshair-cursor position picker for the
        // CURRENT report, not a mission overview), reverted same day once that was raised.
        // D-42 phase 5: rangerUid (unique per ranger, set even with a blank callsign) takes
        // priority over callsign - see ranger-icon.ts's header comment for why.
        let marker = L.marker(new L.LatLng(i.location.lat, i.location.lng), { title: title, icon: rangerIconFor(i.rangerUid || i.callsign) })
        marker.bindPopup(title)
        this.myMarkerCluster.addLayer(marker);
      } else {
        console.warn(`displayAllMarkers: skipping report # ${i.id}; bad lat/lng: ${i}: ${JSON.stringify(i)}`)
      }
    })

    this.lMap.addLayer(this.myMarkerCluster);

    // to refresh markers that have changed:
    // https://github.com/Leaflet/Leaflet.markercluster#refreshing-the-clusters-icon
  }

  // override displayAllMarkers() {
  // this.addMarker(this.radioLog[i].lat, this.radioLog[i].lng, this.radioLog[i].status)
  // }


  // Removed 2026-09-22: getIcon() and createMarker_UNUSED() went with the assets/icons/
  // t0-t7.png marker set. getIcon() had exactly one caller, createMarker_UNUSED(), whose
  // own body was entirely commented out, so nothing reachable drew these. It was also
  // already broken: it rolled `t${Math.floor(Math.random()*6)}` for t0-t5, but no t0.png
  // ever existed and T1/T2 were capitalised, which a case-sensitive host would 404.

  /**
   * Per guidence on settings page: Maps do not use defLat/lng... They are auto-centered on the bounding coordinates centroid of all points entered and the map is then zoomed to show all points.
   * @param lat
   * @param lng
   * @param title
   * @returns
   */
  override addMarker(lat: number, lng: number, title: string = '') {
    if (!lat || !lng || !this.lMap) {
      this.log.error(`addMarker(): bad lat: ${lat} or lng: ${lng} or mapLeaflet: ${this.lMap}`, this.id)
      return
    }

    // 1st dim all previous markers: How to iterate them though?!
    //this.myMarkers.eachChildLayer(fn <= {

    this.clearMarkers()

    let marker = L.marker(new L.LatLng(lat, lng), { title: title }) //, icon: iconDefault,
    marker.bindPopup(title)  //! Needed?!
    this.myMarkerCluster.addLayer(marker);

    //this.myMarkers.push(marker)
    marker.addTo(this.lMap)

    // Refit map
    this.lMap.setView([lat, lng])
    //marker.addEventListener('click', this._markerOnClick);

  }

  private addCircle(lat: number, lng: number, status: string = '') {
    const circle = new L.CircleMarker([lat, lng], { radius: 20 })
    if (this.lMap) {
      circle.addTo(this.lMap)
    }
  }

  private _markerOnClick(e: any) {
    this.log.warn(`Got Marker Click!!!! e= ${JSON.stringify(e)}`, this.id)
  }

  hideMarkers(): void {
    //throw new Error('Method not implemented.')
  }
  clearMarkers(): void {
    this.log.info(`MarkclearMarkers()`, this.id)

    // https://stackoverflow.com/questions/24772022/using-leaflet-js-how-do-i-iterate-through-markers-in-a-cluster
    // if(this.myMarkers.hasLayer(marker) this.myMarkers.removeLayer(marker);
    // if (this.lMap.hasLayer(marker) this.lMap.removeLayer(marker);

    //this.lMap._panes.markerPane.remove()
    //this.lMap.eachLayer((layer) => { layer.remove() }) // !Removes the base map layer too!!!

    this.myMarkerCluster.clearLayers()
    //    throw new Error('Method not implemented.')
  }
  addManualMarkerEvent(event: any): void {
    //throw new Error('Method not implemented.')
  }

  // E-64/E-70 blocker (see LmapComponent.ngOnDestroy() for the full explanation): this
  // class had the same gap - declared OnDestroy, never defined it, so the Leaflet instance
  // was never removed on navigation away from Entry. Entry is the app's most-visited page,
  // so this is the same leak firing on every visit.
  override ngOnDestroy(): void {
    super.ngOnDestroy()
    // removeLeafletMap(), not .remove() - see that helper. Entry is the most-visited page,
    // so this is the instance most likely to be destroyed mid-zoom.
    removeLeafletMap(this.lMap)
  }
}

