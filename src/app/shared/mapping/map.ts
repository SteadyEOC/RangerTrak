/**
 * Abstract class serving as a repository for common/reused map functions
 */
import L from 'leaflet'
import { fromEvent, Observable, Subscription } from 'rxjs'
//import { catchError, mergeMap, toArray } from 'rxjs/operators'

import { DOCUMENT, JsonPipe } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit, Component, ElementRef, Inject, isDevMode, NgZone, OnDestroy, OnInit, ViewChild,
  ChangeDetectionStrategy, signal
} from '@angular/core'

import {
  RadioLogService, RadioLogStatusType, RadioLogType, RadioLogEntryType, LocationType,
  LogService, MissionService, MissionType
} from '../services'

// Imported from its own file, not the '..' barrel. This module is *re-exported by* that
// barrel, so importing it back creates a cycle (barrel -> map.ts -> barrel) that welds
// every module the barrel touches into one unit - including the MapLibre style helpers,
// which is how MapLibre ended up in the eager bundle despite only the lazy /map route
// using it.
import { Utility } from '../utility'
import { Map } from './map.interface'


/**
 * per https://ozak.medium.com/stop-repeating-yourself-in-angular-how-to-create-abstract-components-9726d43c99ab,
 * do NOT use "abstract"!
 *
 * Needs template: https://stackoverflow.com/questions/62222979/angular-9-decorators-on-abstract-base-class
 *
 * https://www.tutorialsteacher.com/typescript/abstract-class
 * https://www.cloudhadoop.com/angular-model-class-interface/
 * https://angular.io/guide/migration-undecorated-classes
 */


/**
 * AbstractMap conceived to handle:
 * - Large (fullpage) Leaflet or Google maps, likely with location markers w/ tooltips
 * - small overview Leaflet or Google maps, at a much larger scale to help locate where one is
 * - mid-sized Current Location map displaying user provided coordinates, as a verification for them
 *
 * Parameters that specify map:
 * - Leaflet or Google
 * - Overview Map : boolean
 * - Display radioLog : boolean
 * - Various Settings: Def_Lat/Lng/Zoom/etc.
 */
@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
export abstract class AbstractMap implements OnInit, OnDestroy {

  protected id = 'Abstract Map Component'
  public title = 'Abstract Map'
  public pageDescr = 'Abstract Map'

  protected missionSubscription!: Subscription
  protected settings!: MissionType

  protected map!: Map
  public location!: LocationType
  public center = { lat: 0, lng: 0 }
  // Mutated from Leaflet's own event listeners (captureLMoveAndZoom, subclass zoomend
  // handlers), not Angular template bindings - this app is zoneless
  // (provideZonelessChangeDetection), so a plain field written there has no guaranteed
  // path back into change detection. Signals close that gap. (Sprint G)
  public mouseLatLng = signal(this.center) // google.maps.LatLngLiteral |
  public zoom = signal(10) // actual zoom level of main map

  protected displayReports = false // Guard for the following
  protected radioLogSubscription!: Subscription
  protected radioLog: RadioLogType | undefined
  protected logEntries: RadioLogEntryType[] = []  // just the individual reports array portion of radioLog
  // The displayedRadioLogEntries can either be all (radioLog) or selectedReports!
  protected displayedRadioLogEntries: RadioLogEntryType[] = []
  // protected markers: clusters?

  protected hasSelectedReports = false // Guard for the following
  protected selectedReports: RadioLogType | undefined = undefined
  // Which set the map is showing. Plain component state, deliberately: this used
  // to be read off an MDCSwitch instance built by hand from a querySelector, and
  // the switch's own click handler raced Angular's - so the map read the state
  // from *before* the click and appeared to reset itself to All. That is what the
  // "[Broken:]" label in the template was apologizing for.
  protected showingSelectedOnly = false
  public numSelectedRows = signal(0)
  public numAllRows = signal(0)

  protected hasOverviewMap = false // Guard for overview map logic
  protected overviewMap: L.Map | undefined = undefined

  //protected iconBase = "./../../../assets/icons/"

  constructor(protected missionService: MissionService,
    protected radioLogService: RadioLogService,
    protected httpClient: HttpClient,
    protected log: LogService,
    @Inject(DOCUMENT) protected document: Document) {

    this.log.excessive(`(Abstract) ======== Constructor() ============`, this.id)

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        // REVIEW: Any new settings just ripple thru, or does anything need pushing?!
        this.settings = newMission
        this.log.excessive('(Abstract) Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('(Abstract) Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('(Abstract) Settings Subscription complete', this.id)
    })

    this.radioLogSubscription =
      this.radioLogService.getRadioLogObserver().subscribe({
        next: (newReport) => {
          this.gotNewRadioLog(newReport)
        },
        error: (e) => this.log.error('(Abstract) Radio Log entries Subscription got:' + e, this.id),
        complete: () => this.log.info('(Abstract) Radio Log entries Subscription complete', this.id)
      })
  }

  /**
   *
   */
  ngOnInit() {
    this.log.verbose("(Abstract) ngOnInit()", this.id)

    if (!this.settings) {
      this.log.error(`(Abstract) this.settings not yet established in ngOnInit()`, this.id)
      // REVIEW: Can initMap run OK w/ defaults, but w/o settings?
    } else {
      this.center = { lat: this.settings.defLat, lng: this.settings.defLng }
      this.mouseLatLng.set(this.center)
    }

    // Derivitive maps should call this.initMap() themselves!
  }

  /**
   *
   * @returns
   */
  initMainMap() {
    this.log.verbose("(Abstract) initMainMap()", this.id)

    if (!this.settings) {
      this.log.error(`(Abstract) initMainMap(): Settings not yet initialized while initializing the abstract Map!`, this.id)
      return
    }

    this.center = { lat: this.settings ? this.settings.defLat : 0, lng: this.settings ? this.settings.defLng : 0 }
    this.mouseLatLng.set(this.center)

    if (!this.radioLog) { //! or displayedRadioLogEntries
      this.log.error(`(Abstract) initMainMap(): radioLog not yet initialized while initializing abstract Map!`, this.id)
      return
    }
  }

  /*
    Not needed, but available...
    if (this.map instanceof L.Map) {
      // leaflet map
      // TODO
    } else if (this.map instanceof google.maps.Map) {
      // google map
      // TODO
    } else {
      this.log.warn(`(Abstract) map initMainMap(): map not a leaflet or google map - ignoring as uninitialized?`, this.id)
    }
    */

  captureLMoveAndZoom(map: L.Map) {
    if (!map) {
      this.log.warn(`(Abstract) No map in captureLMoveAndZoom()`, this.id)
      return
    }

    map.on('mousemove', ($event: L.LeafletMouseEvent) => {
      if ($event.latlng) {
        this.mouseLatLng.set($event.latlng) //.toJSON()
      } else {
        this.log.warn(`(Abstract) No latlng on event in captureLMoveAndZoom()`, this.id)
      }
    })
  }

  /**
  * Copies the clicked point's lat/lng to the clipboard. (A "drop a marker here" mode was
  * never built; its setting was removed 2026-09-26 - E-127 keeps the idea.)
  *
  * @param ev
  */
  onMouseClick(ev: MouseEvent) {
    // lMap has override onMouseClick()

    if (!this.map) {
      this.log.error(`(Abstract) onMouseClick: Map not created, so can't get lat & lng`, this.id)
      return
    }

    // Put coordinates into clipboard
    let latlng = this.map.mouseEventToLatLng(ev)
    let coords = `${Math.round(latlng.lat * 10000) / 10000}, ${Math.round(latlng.lng * 10000) / 10000}`
    navigator.clipboard.writeText(coords)
      .then(() => {
        let status = document.getElementById('map-status')
        if (status) {
          status.innerText = `${coords} copied to clipboard`
          //status.style.visibility = "visible"
          Utility.resetMaterialFadeAnimation(status)
        } else {
          this.log.info(`(Abstract) onMouseClick Entry__Minimap-status not found!`, this.id)
        }
        this.log.excessive(`(Abstract) ${coords} copied to clipboard`, this.id)
      })
      .catch(err => {
        this.log.error(`(Abstract) onMouseClick latlng NOT copied to clipboard, error: ${err}`, this.id)
      })
  }

  clamp(num: number, min: number, max: number) {
    return Math.min(Math.max(num, min), max)
  }

  abstract refreshMap(): void
  //  {
  //   this.log.error(`(Abstract) refreshMap() is unimplemented!`, this.id)
  // }

  // ------------------------------------  Radio Log entries  ---------------------------------------

  /**
   * Refresh the row counts shown beside the all/selected control.
   *
   * Used to also build an MDCSwitch (twice), re-query the DOM in ngOnInit before
   * the view existed, and log an error on any map that has no such control -
   * which is why the Entry page's mini-map complained on every load. It touches
   * no DOM now; the template binds to numAllRows/numSelectedRows directly.
   */
  updateRadioLog() {
    this.log.excessive(`updateRadioLog()`, this.id)

    this.numAllRows.set(this.radioLog?.numReport ?? 0)

    if (!this.hasSelectedReports) {
      // Normal for maps without an all/selected control (e.g. the Entry mini-map).
      return
    }

    this.selectedReports = this.radioLogService.getSelectedRadioLogEntries()
    this.numSelectedRows.set(this.selectedReports?.logEntries.length ?? 0)

    this.displayedRadioLogEntries = this.showingSelectedOnly
      ? (this.selectedReports?.logEntries ?? [])
      : (this.radioLog?.logEntries ?? [])
  }



  gotNewRadioLog(newReports: RadioLogType) {
    this.log.verbose(`(Abstract) gotNewRadioLog(): New collection of ${newReports.numReport} Radio Log entries observed.`, this.id)

    this.numAllRows.set(newReports.numReport)
    this.radioLog = newReports
    this.logEntries = newReports.logEntries
    console.assert(this.numAllRows() == this.logEntries.length)
    // Keeps displayedRadioLogEntries and the row counts in step with the new
    // reports while honoring the current all/selected choice.
    this.updateRadioLog()
    if (this.map) {
      this.refreshMap()
    }
    // this.reloadPage()  // TODO: needed?
  }

  /**
   *
   * @returns
   */

  /**
   * User toggled the all/selected control. The caller is the template's change
   * event, so the component owns the state and there is no second source of
   * truth to disagree with.
   */
  onSwitchSelectedRadioLog() {
    if (!this.radioLog) {
      this.log.error(`(Abstract) onSwitchSelectedRadioLog(): Radio Log entries not yet set`, this.id)
      return
    }

    this.showingSelectedOnly = !this.showingSelectedOnly
    this.updateRadioLog()

    this.log.verbose(`(Abstract) onSwitchSelectedRadioLog(): displaying ${this.displayedRadioLogEntries.length} ${this.showingSelectedOnly ? 'SELECTED' : 'ALL'} radio log entries`, this.id)

    this.refreshMap()
  }

  // ------------------------------------  Markers  ---------------------------------------

  abstract addMarker(lat: number, lng: number, title: string): void
  abstract hideMarkers(): void
  abstract clearMarkers(): void

  displayMarkers() {
    this.log.verbose(`(Abstract) displayMarkers()`, this.id)

    if (!this.displayReports) {
      this.log.error(`(Abstract) displayMarkers() BUT displayReports is false!`, this.id)
    }

    if (!this.displayedRadioLogEntries) {
      this.log.error(`(Abstract) displayMarkers() BUT No Radio Log entries received yet!`, this.id)
      return
    }

    //! this.addMarker(this.radioLog[i].location.lat, this.radioLog[i].location.lng, this.radioLog[i].status)
  }

  // Deletes all markers in the array by removing references to them
  // https://developers.google.com/maps/documentation/javascript/markers#remove
  removeAllMarkers() {
    this.log.verbose(`(Abstract) removeAllMarkers()`, this.id)
    this.hideMarkers()
  }

  ngOnDestroy() {
    // this.locationSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
    this.missionSubscription?.unsubscribe()
  }
}
