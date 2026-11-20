import { Subscription } from 'rxjs'

import { CommonModule } from '@angular/common'
import {
  AfterViewInit, Component, EventEmitter, Inject, Input, linkedSignal, OnChanges, OnDestroy,
  OnInit, Output, signal, SimpleChanges, ChangeDetectionStrategy
} from '@angular/core'
import { form, FormField, max, min, pattern } from '@angular/forms/signals'

// https://floating-ui.com superceeds popper.js; https://lokesh-coder.github.io/toppy may be simpler!
//import { computePosition } from '@floating-ui/dom'

import { faInfoCircle, faMapMarkedAlt } from '@fortawesome/free-solid-svg-icons'
import { mdiAccount, mdiInformationOutline } from '@mdi/js'

//import { MatIconRegistry } from '@angular/material/icon'

// Imported from their own files rather than the '../shared/' barrel on purpose: that
// barrel also re-exports the MapLibre style helpers, so pulling anything through it from
// the eagerly-loaded Entry page drags MapLibre (~800KB) into the initial bundle even
// though this page never shows a MapLibre map. Same reasoning as app.config.ts.
import {
  DDMToDD, DDToDDM, DDToDMS, DDToMaidenhead, DDToMGRS, DDToUTM, DMSToDD, isMaidenhead,
  MaidenheadToDD, MGRSToDD, UTMToDD,
  COORDINATE_FORMATS, CoordinateFormat, defaultCoordinateFormat, normalizeCoordinateFormat,
} from '../domain/coordinate'
import { GEOCODING_PROVIDER, GeocodingProvider } from '../shared/mapping/geocoding-provider.interface'
import { OpenLocationCode } from '../shared/mapping/open-location-code'

import {
  LocationType, LogService, MissionService, MissionType, undefinedAddressFlag, undefinedLocation
} from '../shared/services'
import { DevicePrefsService } from '../shared/services/device-prefs.service'
import { ViewService } from '../shared/services/view.service'
import { AdvancedDirective } from '../shared/view/advanced.directive'
import { RouterLink } from '@angular/router'

import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatChipsModule } from '@angular/material/chips'

// E-114 §1a (2026-08-31): "the ranger will almost always use the same coordinate system, so
// initially we offer ALL OPTIONS, then just default to that" - the maintainer's own design.
// Persisted per device by DevicePrefsService (key `lastCoordinateFormat`) - see activeSystem's
// constructor-time resolution below for where this outranks the mission's own
// preferredSystems() default.

/*
https://stackoverflow.com/questions/43270564/dividing-a-form-into-multiple-components-with-validation
https://www.digitalocean.com/community/tutorials/how-to-build-nested-model-driven-forms-in-angular-2
https://stackblitz.com/edit/angular-azzmhu?file=src/app/hello.component.ts
*/

@Component({
  //moduleId: module.id,
  selector: 'rangertrak-location',
  standalone: true,
  imports: [CommonModule, FormField, MatFormFieldModule, MatInputModule, MatButtonModule, MatButtonToggleModule, MatChipsModule, MatIconModule, AdvancedDirective, RouterLink],
  templateUrl: './location.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./location.component.scss']
})
export class LocationComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {

  // Using mediation pattern (pg 188), this child component emits following event to parent,
  // parent's template has: (newLocationEvent)="onNewLocationParent($event)"
  // Parent's onNewLocationParent($event) gets called.
  // Parent then passes the new location (via binding), to any children (e.g., mini-maps) as needed
  @Input() location: LocationType = undefinedLocation
  @Output() locationChange = new EventEmitter<LocationType>()

  // E-48(1): bumped by the parent Entry form on submit/reset (see resetAll() there) so the
  // derived-output block below can be told "a fresh report started" independently of
  // whether the position itself also changed - a scribe entering several reports from the
  // same spot keeps the coordinates but shouldn't keep seeing the PREVIOUS report's derived
  // Address/+Codes text as if it belonged to the new one.
  @Input() formGeneration = 0

  // E-48(1): starts false so the block stays hidden until a derivation has actually
  // completed for the current report - set true at the end of updateDerivedLocations()
  // below, reset to false in ngOnChanges whenever formGeneration bumps (submit/reset). This
  // is what stops a fresh report from briefly showing the PREVIOUS report's derived
  // Address/+Codes text before its own position has resolved.
  showDerived = signal(false)

  /**
   * E-302 (John 11-14, approved): the Address box holds what was SAID ("NE corner of the cemetery"), and the
   * scribe places the point on the map. `addressTyped` is true once the scribe has typed in the box for this
   * report: their text is then kept as the report's address when the point moves, and a looked-up street address
   * only shows underneath, labelled "(inferred)". Leaving the box never looks the text up (that could move the
   * point); Enter or the search button does, on purpose.
   */
  addressTyped = false
  /** True when the Address line underneath is a lookup from the position, not what was said. */
  derivedAddressInferred = signal(false)

  // Raised live 2026-08-30: street-address geocoding (chkStreetAddress(), below) needs the
  // network - unlike +Code and Maidenhead, which are pure offline conversions - so the label
  // dims the word "Street address" specifically while offline, rather than leaving a scribe
  // to discover the distinction only after typing an address and getting nothing back. Plain
  // `navigator.onLine`/`online`/`offline` rather than a shared service: nothing else in the
  // app tracks connectivity today, and this is the only place that currently needs it.
  isOnline = signal(navigator.onLine)
  private readonly onOnline = () => this.isOnline.set(true)
  private readonly onOffline = () => this.isOnline.set(false)

  // Base tabindex for this leaf's fields (DD/DDM/DMS lat+lng, MGRS, UTM, then address),
  // in the exact top-to-bottom/left-to-right DOM order the template renders them.
  // Unset (no tabindex attribute rendered) unless Entry's keyboard-first pass supplies
  // one - see ti() below and Entry's usage.
  //
  // Sprint H: each field still gets a fixed offset slot regardless of whether its
  // system is currently visible - far simpler than recomputing offsets from the
  // live-visible set on every settings change. Originally ("hiding a system just leaves
  // a gap, which is harmless, tab order stays monotonic") the template hid a system with
  // @if, which removes its elements from the DOM - harmless as long as SOME system always
  // defaulted visible, which stopped being true the day MGRS/UTM defaulted to off (0.57.0)
  // and broke this app's own "contiguous explicit tabindex" e2e invariant. E-11 pass
  // (2026-08-26): location.component.html now hides each system with [hidden] instead,
  // the same convention every conditional section added since (213 fields, evidence-
  // location) already uses - the slot stays reserved AND present, so contiguity holds
  // regardless of which systems are on.
  // TAB_SLOT_COUNT is the total reservation the parent (Entry) needs to leave before
  // its own next tabbable field - see entry.component.ts.
  @Input() tabIndexStart?: number

  static readonly TAB_SLOT_COUNT = 26 // DD(4) + DDM(6) + DMS(8) + MGRS(3) + UTM(4) + address(1)

  /** Field position within this leaf, 0-25 in template order. See tabIndexStart above. */
  ti(offset: number): number | null {
    return this.tabIndexStart != null ? this.tabIndexStart + offset : null
  }

  /**
   * Material-M3 pass, 2026-08-26 (E-104): which ONE coordinate system currently has the
   * live, editable input fields. Before this, `isVisible()` (below) could be true for
   * SEVERAL systems at once - every one enabled in Mission Settings, plus every one if the
   * old `showAllSystems` toggle was on - so a scribe could face up to 22 simultaneous input
   * boxes (DD's 4 + DDM's 6 + DMS's 8 + MGRS's 3 + UTM's 4 - address).
   *
   * This is a PRESENTATION change only, deliberately: `ddModel`/`ddmModel`/`dmsModel`/
   * `mgrsModel`/`utmModel` above are already pure `linkedSignal`s recomputed from the one
   * `canonical` signal, so every representation was ALREADY continuously kept in sync
   * regardless of which one a scribe happened to be looking at - that is what makes
   * `otherSystemsDisplay()` below possible with no new derivation logic, just formatting
   * already-live values. Nothing about `onDdChg()`/`onDdmChg()`/etc., the five `xxxForm`
   * Signal Forms trees, their validators, or the `[hidden]`/`ti()` tabindex-reservation
   * mechanism changes - see `isVisible()` below for why this keeps `TAB_SLOT_COUNT` fixed
   * at 26 and entry.component.ts's downstream chain completely untouched, which is what
   * keeps this a contained, e2e-verifiable change rather than one that ripples through
   * every tabindex offset after Where.
   *
   * Defaults to 'DD' before settings arrive; corrected once real settings land, in the
   * subscription below, to this mission's own preferred starting format if it has one (see
   * `preferredSystems()`).
   */
  activeSystem = signal<CoordinateFormat>('DD')

  /** Guards the settings subscription's one-time initial-default correction below, so a
   * later settings change never re-applies it mid-session. */
  private activeSystemDefaultSet = false

  /** Canonical display order, reused by the switcher and by `preferredSystems()` below. */
  private static readonly SYSTEM_ORDER: CoordinateFormat[] = COORDINATE_FORMATS.map(f => f.id)

  /**
   * Every system the switcher offers - unconditionally all five, regardless of Mission
   * Settings.
   *
   * NOT gated by settings.showXX. An earlier version of this method filtered down to only
   * the mission's enabled systems - wrong, caught live by the maintainer: "without the
   * 'show all coordinate systems' checkbox how am I supposed to enter an unexpected radio
   * call using other coordinates? I now only see one entry format." The OLD showAllSystems
   * toggle was not merely "see several systems at once" - it was ALSO the only way to reach
   * a format Settings hadn't enabled (MGRS/UTM default off), and retiring it without
   * replacing that half of its job silently made an unexpected MGRS/UTM call impossible to
   * enter without a trip to Mission Settings first, mid-incident. A scribe must always be
   * able to reach any format Entry supports, in one tap, regardless of what this mission
   * usually expects - see `preferredSystems()` below for where settings.showXX actually
   * matters now (which format Entry opens on, not which formats exist).
   */
  /** The switcher's choices, with the labels the Map uses (E-208). */
  readonly formats = COORDINATE_FORMATS

  availableSystems(): CoordinateFormat[] {
    return LocationComponent.SYSTEM_ORDER
  }

  /**
   * The mission's own preferred format(s), per Mission Settings' "coordinate systems shown
   * on Entry" checkboxes - used ONLY to pick which format `activeSystem` opens on (see the
   * settings subscription below), never to restrict `availableSystems()`. A mission that
   * mostly works in MGRS can have Entry open there by default while every other format
   * stays one tap away regardless.
   */
  private preferredSystems(): CoordinateFormat[] {
    if (!this.settings) return LocationComponent.SYSTEM_ORDER
    return LocationComponent.SYSTEM_ORDER.filter(s => this.systemPreferredInSettings(s))
  }

  private systemPreferredInSettings(system: CoordinateFormat): boolean {
    if (!this.settings) return true
    switch (system) {
      case 'DD': return this.settings.showDD
      case 'DDM': return this.settings.showDDM
      case 'DMS': return this.settings.showDMS
      case 'MGRS': return this.settings.showMGRS
      case 'UTM': return this.settings.showUTM
    }
  }

  /** The switcher's own handler - a plain component signal, not a Signal Forms field, so
   * no [formField]/CVA question applies here at all (unlike Source's own switcher on the
   * parent Entry form). */
  setActiveSystem(system: CoordinateFormat): void {
    this.activeSystem.set(system)
    // E-114 §1a: remembered across devices/sessions/missions - see the E-114 §1a comment near
    // the imports. Written on every switch, not just the first, so it always reflects
    // whatever this scribe/ranger most recently actually used.
    this.devicePrefs.setLastCoordinateFormat(system)
  }

  /**
   * A system's editable fields are visible IFF it is the active one. Reserved-but-hidden
   * for the other four either way (see the template's `[hidden]="!isVisible(...)"`, one
   * `<span>` per system, unchanged from before this pass) - which is exactly what keeps
   * `TAB_SLOT_COUNT` a fixed 26 regardless of which system happens to be active: all five
   * systems' fields stay present in the DOM with their `ti()`-assigned tabindex attributes
   * at all times, only the CSS `hidden` state (driven by this method) changes which one a
   * scribe can actually reach by tabbing or see on screen.
   */
  isVisible(system: CoordinateFormat): boolean {
    return this.activeSystem() === system
  }

  private id = "Location Component"

  // Single source of truth for the whole component - replaces the old locationFormModel
  // FormGroup. Every displayed representation (DD/DDM/DMS) below is a *pure* linkedSignal
  // derived from this. linkedSignal's "recompute fresh from source, but stay manually
  // writable until the source changes again" semantics are exactly what replaces the old
  // debounce/merge/switch dispatcher (mergeForm()) and its `{ emitEvent: false }` loop guard -
  // no manual loop-breaking is needed anywhere in this file anymore.
  private canonical = signal<{ lat: number; lng: number }>({ lat: 0, lng: 0 })

  // Coordinates as Decimal Degrees (DD)
  //
  // 2026-10-01, BREAKING BUG fixed (found by the blog session): the fraction was a NUMBER, so
  // 36.0524 split into 36 and 524, the box showed "36 . 524", and onDdChg() rebuilt 36.524 -
  // editing ANY DD box moved a position whose decimals start with 0 by up to ~55 km, and a
  // scribe typing "0524" got 524. Both parts are now digit STRINGS: the fraction keeps its
  // leading zeros, and the degrees keep a "-0" (a number input showed -0.12, e.g. London's
  // longitude, as 0 and rebuilt it as +0.12). Five decimals (about 1 m), trailing zeros
  // trimmed. See LocationComponent.ddPartsToDegrees() for the way back.
  ddModel = linkedSignal(() => {
    const { lat, lng } = this.canonical()
    const lat2 = LocationComponent.degreesToDdParts(lat)
    const lng2 = LocationComponent.degreesToDdParts(lng)
    return { latI: lat2.i, latF: lat2.f, lngI: lng2.i, lngF: lng2.f }
  })

  /** 36.0524 -> { i: '36', f: '0524' }; -0.12 -> { i: '-0', f: '12' }; rounded to 5 places. */
  static degreesToDdParts(deg: number): { i: string, f: string } {
    const [int, frac] = Math.abs(deg).toFixed(5).split('.')
    const negative = deg < 0 && Number(`${int}.${frac}`) !== 0
    return { i: (negative ? '-' : '') + int, f: frac.replace(/0+$/, '') || '0' }
  }

  /** The way back from the two boxes: ('36', '0524') -> 36.0524; ('-0', '12') -> -0.12. */
  static ddPartsToDegrees(i: string, f: string): number {
    const neg = String(i).trim().startsWith('-')
    const magnitude = Math.abs(Number(String(i).trim())) + Number(`0.${String(f).trim() || '0'}`)
    return neg ? -magnitude : magnitude
  }
  // Sprint E, step 5 (2026-08-19): min/max were static HTML attributes stripped to fix
  // NG8022 ([formField] cannot coexist with them - Signal Forms owns them from schema). This
  // schema restores them as real validators AND fixes two bugs found while restoring it:
  // latI's range was -180..180 (longitude's range, copy-pasted onto latitude) rather than
  // the correct -90..90.
  // 2026-10-01: the parts are strings now (see ddModel), so the ranges are patterns: whole
  // degrees -90..90 / -180..180 (a "-0" allowed), and 1-6 fraction digits.
  ddForm = form(this.ddModel, (p) => {
    pattern(p.latI, /^\s*-?(\d|[1-8]\d|90)\s*$/)
    pattern(p.latF, /^\s*\d{1,6}\s*$/)
    pattern(p.lngI, /^\s*-?(\d{1,2}|1[0-7]\d|180)\s*$/)
    pattern(p.lngF, /^\s*\d{1,6}\s*$/)
  })

  // Coordinates as Degrees & Decimal Minutes (DDM)
  ddmModel = linkedSignal(() => {
    const { lat, lng } = this.canonical()
    const latDDM = DDToDDM(lat)
    const lngDDM = DDToDDM(lng, true)
    // DDToDDM()'s `.min` property is scaled *100 - divide back down to real decimal minutes
    // for display/editing. DDMToDD() (used in onDdmChg() below) takes real minutes back, no
    // scaling. This exact scaling was already load-bearing in the pre-conversion code
    // (`latDdmM: latDDM.min / 100`) - easy to get backwards, preserved precisely here.
    return {
      latDdmQ: latDDM.dir, latDdmD: latDDM.deg, latDdmM: latDDM.min / 100,
      lngDdmQ: lngDDM.dir, lngDdmD: lngDDM.deg, lngDdmM: lngDDM.min / 100,
    }
  })
  // Same restoration, plus the same latitude-range-onto-longitude bug for the degrees
  // component (lngDdmD was capped at 90, not 180), AND a separate, longstanding one: the
  // direction-letter pattern (and the template's title=) were SWAPPED between lat and lng -
  // latDdmQ validated/labelled E-or-W, lngDdmQ validated/labelled N-or-S. DDMToDD()'s parser
  // only checks for a literal 'w' or 's' to negate, so it silently accepted whichever letter
  // arrived regardless of which field it came from - the math was never wrong, only the
  // on-screen hint telling the user which letters were valid where.
  ddmForm = form(this.ddmModel, (p) => {
    min(p.latDdmD, 0); max(p.latDdmD, 90)
    min(p.latDdmM, 0); max(p.latDdmM, 59)
    pattern(p.latDdmQ, /^[NnSs]$/)
    min(p.lngDdmD, 0); max(p.lngDdmD, 180)
    min(p.lngDdmM, 0); max(p.lngDdmM, 59)
    pattern(p.lngDdmQ, /^[EeWw]$/)
  })

  // Coordinates as Degrees, Minutes & Seconds (DMS)
  dmsModel = linkedSignal(() => {
    const { lat, lng } = this.canonical()
    const latDMS = DDToDMS(lat)
    const lngDMS = DDToDMS(lng, true)
    // Unlike DDM above, DDToDMS's min/sec need no scaling - direct pass-through.
    return {
      latQ: latDMS.dir, latD: latDMS.deg, latM: latDMS.min, latS: latDMS.sec,
      lngQ: lngDMS.dir, lngD: lngDMS.deg, lngM: lngDMS.min, lngS: lngDMS.sec,
    }
  })
  // Same two fixes as ddmForm above, applied to the DMS representation.
  dmsForm = form(this.dmsModel, (p) => {
    min(p.latD, 0); max(p.latD, 90)
    min(p.latM, 0); max(p.latM, 59)
    min(p.latS, 0); max(p.latS, 59.99)
    pattern(p.latQ, /^[NnSs]$/)
    min(p.lngD, 0); max(p.lngD, 180)
    min(p.lngM, 0); max(p.lngM, 59)
    min(p.lngS, 0); max(p.lngS, 59.99)
    pattern(p.lngQ, /^[EeWw]$/)
  })

  // Coordinates as MGRS (US military / FEMA grid standard), split into three fields -
  // Grid Reference (zone+band+100km-square), Easting, Northing - rather than one
  // opaque string, matching how MGRS is actually read aloud over radio and the same
  // "split by component" convention DD/DDM/DMS use above. Sprint H.
  mgrsModel = linkedSignal(() => {
    const { lat, lng } = this.canonical()
    return DDToMGRS(lat, lng)
  })
  mgrsForm = form(this.mgrsModel, (p) => {
    pattern(p.gridRef, /^[0-9]{1,2}[C-HJ-NP-Xc-hj-np-x][A-HJ-NP-Za-hj-np-z]{2}$/)
    min(p.easting, 0); max(p.easting, 99999)
    min(p.northing, 0); max(p.northing, 99999)
  })

  // Coordinates as UTM - Zone/Hemisphere/Easting/Northing. Hemisphere is a plain N/S
  // letter (same pattern idiom as the DDM/DMS lat-direction fields), not the `utm`
  // package's own latitude-band letter, which would need a second letter system users
  // don't otherwise touch. Sprint H.
  utmModel = linkedSignal(() => {
    const { lat, lng } = this.canonical()
    return DDToUTM(lat, lng)
  })
  utmForm = form(this.utmModel, (p) => {
    min(p.zone, 1); max(p.zone, 60)
    pattern(p.hemisphere, /^[NnSs]$/)
    min(p.easting, 0); max(p.easting, 999999)
    min(p.northing, 0); max(p.northing, 10000000)
  })

  addressModel = signal('')
  addressForm = form(this.addressModel)

  /**
   * One summary error line per coordinate, rather than nine - three representations (DD/
   * DDM/DMS) times three-ish fields each would otherwise need nine separate messages
   * crammed into an already-dense row. `touched()` gates each check so nothing shows before
   * the user has actually reached that field.
   */
  latInvalid(): boolean {
    return (this.ddForm.latI().touched() && this.ddForm.latI().invalid())
      || (this.ddForm.latF().touched() && this.ddForm.latF().invalid())
      || (this.ddmForm.latDdmD().touched() && this.ddmForm.latDdmD().invalid())
      || (this.ddmForm.latDdmM().touched() && this.ddmForm.latDdmM().invalid())
      || (this.ddmForm.latDdmQ().touched() && this.ddmForm.latDdmQ().invalid())
      || (this.dmsForm.latD().touched() && this.dmsForm.latD().invalid())
      || (this.dmsForm.latM().touched() && this.dmsForm.latM().invalid())
      || (this.dmsForm.latS().touched() && this.dmsForm.latS().invalid())
      || (this.dmsForm.latQ().touched() && this.dmsForm.latQ().invalid())
  }

  lngInvalid(): boolean {
    return (this.ddForm.lngI().touched() && this.ddForm.lngI().invalid())
      || (this.ddForm.lngF().touched() && this.ddForm.lngF().invalid())
      || (this.ddmForm.lngDdmD().touched() && this.ddmForm.lngDdmD().invalid())
      || (this.ddmForm.lngDdmM().touched() && this.ddmForm.lngDdmM().invalid())
      || (this.ddmForm.lngDdmQ().touched() && this.ddmForm.lngDdmQ().invalid())
      || (this.dmsForm.lngD().touched() && this.dmsForm.lngD().invalid())
      || (this.dmsForm.lngM().touched() && this.dmsForm.lngM().invalid())
      || (this.dmsForm.lngS().touched() && this.dmsForm.lngS().invalid())
      || (this.dmsForm.lngQ().touched() && this.dmsForm.lngQ().invalid())
  }

  /** MGRS and UTM each encode one whole position (not separate lat/lng blocks like
   * DD/DDM/DMS above), so one combined check each is enough. */
  mgrsInvalid(): boolean {
    return (this.mgrsForm.gridRef().touched() && this.mgrsForm.gridRef().invalid())
      || (this.mgrsForm.easting().touched() && this.mgrsForm.easting().invalid())
      || (this.mgrsForm.northing().touched() && this.mgrsForm.northing().invalid())
  }

  utmInvalid(): boolean {
    return (this.utmForm.zone().touched() && this.utmForm.zone().invalid())
      || (this.utmForm.hemisphere().touched() && this.utmForm.hemisphere().invalid())
      || (this.utmForm.easting().touched() && this.utmForm.easting().invalid())
      || (this.utmForm.northing().touched() && this.utmForm.northing().invalid())
  }

  faInfoCircle = faInfoCircle
  faMapMarkedAlt = faMapMarkedAlt
  mdiAccount: string = mdiAccount
  mdiInformationOutline: string = mdiInformationOutline

  private missionSubscription!: Subscription
  // Public (not private): the template reads settings.showXxx to decide which
  // coordinate systems to render (Sprint H).
  public settings!: MissionType

  // Tracks our own most recent emission so ngOnChanges (the opportunistic re-centering fix,
  // see below) can tell "parent gave us a genuinely new location" apart from "parent just
  // echoed back the [(location)] value we ourselves emitted a moment ago" - without this guard
  // that echo would loop forever.
  private lastEmitted: { lat: number; lng: number } | null = null

  constructor(
    private missionService: MissionService,
    private log: LogService,
    private devicePrefs: DevicePrefsService,
    public view: ViewService,
    @Inject(GEOCODING_PROVIDER) private geocodingProvider: GeocodingProvider,
    // private _toppy: Toppy,
  ) {

    // https://angular.io/tutorial/toh-pt4#call-it-in-ngoninit states subscribes should happen in OnInit()
    // Settings only needed for Check PCode...
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission

        // `activeSystem` defaults to 'DD' before real settings arrive (a synchronous
        // default is needed for the first render). Once real settings land, open on this
        // mission's own preferred format instead, if it has one that isn't DD - but only
        // on the FIRST arrival. Unlike an earlier version of this correction, this is a
        // one-time initial default, not an ongoing enforcement: availableSystems() now
        // always offers every format (see its own comment for why - a scribe must always
        // be able to reach any format, not just this mission's preferred ones), so there is
        // no "invalid" active system to correct anymore. Re-running this on every settings
        // change would yank a scribe back to the mission's preferred format mid-report
        // just because Settings changed in another tab, which is actively disruptive now
        // that it is no longer fixing a real invalidity.
        if (!this.activeSystemDefaultSet) {
          this.activeSystemDefaultSet = true
          // E-114 §1a: whatever this device last actually used outranks the mission's own
          // preferred format - a stronger, more specific signal (see
          // the E-114 §1a comment above the class for the maintainer's reasoning).
          const remembered = this.devicePrefs.getLastCoordinateFormat()
          // normalize: a device that remembered an older value still resolves to a current one.
          const rememberedValid = normalizeCoordinateFormat(remembered)
          const preferred = rememberedValid ?? defaultCoordinateFormat(this.settings)
          if (preferred) this.activeSystem.set(preferred)
        }
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id)
    })

  }

  // Initialize data or fetch external data from services or API (https://geeksarray.com/blog/angular-component-lifecycle)
  ngOnInit(): void {

    this.newLocationToFormAndEmit(this.location)

    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
  }

  /**
    * Called once all HTML elements have been created
    */
  ngAfterViewInit() {
    // doing emit here causes: NG0100: Expression has changed after it was checked
    // this.newLocationToFormAndEmit(this.location)
  }

  /**
   * Opportunistic fix (Sprint D): the pre-conversion code never re-centered on later changes
   * to [location] after its initial value (flagged there as `!BUG: Doesn't center on initial
   * (previously received) location...`). Guarded via lastEmitted against re-processing our
   * own [(location)] echo, which would otherwise loop forever through the parent's two-way
   * binding.
   */
  ngOnChanges(changes: SimpleChanges): void {
    // E-48(1): a fresh report started, so the derived block clears - which is the
    // requirement as stated ("should clear once the report is submitted"), not merely a
    // side effect. It stays cleared until this report's own position resolves; it is NOT
    // re-derived from the outgoing position here.
    //
    // That distinction is deliberate and was got wrong once. The position deliberately
    // survives a reset (consecutive reports from one spot are normal - see resetAll() in
    // entry.component.ts), so re-deriving "for free" is tempting. But the whole complaint
    // was that this block showed text belonging to a report the scribe had already filed;
    // anything auto-refilled before the new report has a position of its own recreates
    // exactly that, just one step later. Empty is honest.
    if (changes['formGeneration'] && !changes['formGeneration'].firstChange) {
      this.showDerived.set(false)
      this.clearDerivedText()
      this.addressTyped = false // E-302: a new report; what was said for the last one no longer leads
    }

    if (!changes['location'] || changes['location'].firstChange) return

    const incoming = this.location
    if (this.lastEmitted && incoming.lat === this.lastEmitted.lat && incoming.lng === this.lastEmitted.lng) {
      return // our own emission, echoed back via the parent's [(location)] binding
    }
    const current = this.canonical()
    if (incoming.lat === current.lat && incoming.lng === current.lng) {
      return // no real change
    }
    this.newLocationToFormAndEmit(incoming)
  }

  /**
   * https://angular.io/guide/template-reference-variables
   */
  onDdChg() {
    const { latI, latF, lngI, lngF } = this.ddModel()
    const lat = LocationComponent.ddPartsToDegrees(latI, latF)
    const lng = LocationComponent.ddPartsToDegrees(lngI, lngF)
    // A box holding something that isn't a number (the pattern marks it red) must not move
    // the position to NaN; nothing is emitted until it's corrected.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return
    }

    const enteredLocation = {
      lat,
      lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    }
    this.newLocationToFormAndEmit(enteredLocation)
  }

  onDdmChg() {
    const { latDdmD, latDdmM, latDdmQ, lngDdmD, lngDdmM, lngDdmQ } = this.ddmModel()

    const latLng = {
      lat: DDMToDD(<string>latDdmQ, latDdmD, latDdmM)!,
      lng: DDMToDD(<string>lngDdmQ, lngDdmD, lngDdmM)!
    }

    const enteredLocation = {
      lat: latLng.lat,
      lng: latLng.lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    }

    this.newLocationToFormAndEmit(enteredLocation)
  }

  onDmsChg() {
    const { latD, latM, latS, latQ, lngD, lngM, lngS, lngQ } = this.dmsModel()

    const latLng = {
      lat: DMSToDD(latQ, latD, latM, latS)!,
      lng: DMSToDD(lngQ, lngD, lngM, lngS)!
    }

    const enteredLocation = {
      lat: latLng.lat,
      lng: latLng.lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    }
    this.newLocationToFormAndEmit(enteredLocation)
  }

  onMgrsChg() {
    const { gridRef, easting, northing } = this.mgrsModel()

    const converted = MGRSToDD(gridRef, easting, northing)
    if (!converted) {
      this.log.verbose(`onMgrsChg: MGRSToDD rejected "${gridRef}" ${easting} ${northing}`, this.id)
      return
    }

    const enteredLocation = {
      lat: converted.lat,
      lng: converted.lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    }
    this.newLocationToFormAndEmit(enteredLocation)
  }

  onUtmChg() {
    const { zone, hemisphere, easting, northing } = this.utmModel()

    const converted = UTMToDD(zone, hemisphere, easting, northing)
    if (!converted) {
      this.log.verbose(`onUtmChg: UTMToDD rejected ${zone}${hemisphere} ${easting} ${northing}`, this.id)
      return
    }

    const enteredLocation = {
      lat: converted.lat,
      lng: converted.lng,
      address: undefinedAddressFlag,
      derivedFromAddress: false
    }
    this.newLocationToFormAndEmit(enteredLocation)
  }

  /** Friendly label for the switcher and the "other formats" strip - kept separate from the
   * short 'DD'/'DDM'/... codes used as the type/keys, since a scribe reads the label. */
  systemLabel(system: CoordinateFormat): string {
    switch (system) {
      case 'DD': return 'Decimal degrees'
      case 'DDM': return 'Degrees decimal minutes'
      case 'DMS': return 'Degrees minutes seconds'
      case 'MGRS': return 'USNG/MGRS'
      case 'UTM': return 'UTM'
    }
  }

  /**
   * E-104: one formatted line per system OTHER than the currently-active one, for the
   * read-only "same position, other formats" strip - the replacement for the old
   * ~20-simultaneous-input grid. Reads straight from the already-live `xxxModel()`
   * `linkedSignal`s above; no new geocoding, no new derivation, no async - these are the
   * exact same values the hidden input fields for those systems already hold, just
   * formatted for display rather than editing. Genuinely reactive (a real Angular binding
   * in the template, `{{ ... }}`), unlike the legacy Address/+Codes/Maidenhead readouts
   * below - those are `setDerivedText()`'s direct DOM writes, kept exactly as they were
   * (see that method's own comment for why converting THEM is explicitly out of scope
   * here, a separate roadmap item). There is no such legacy debt for these three - they are
   * new with this pass, so they get real bindings from the start.
   */
  otherSystemsDisplay(): { system: CoordinateFormat; label: string; value: string }[] {
    const active = this.activeSystem()
    return LocationComponent.SYSTEM_ORDER
      .filter(s => s !== active)
      .map(system => ({ system, label: this.systemLabel(system), value: this.formatSystem(system) }))
  }

  /**
   * Which row was most recently copied, so the template can show a brief "copied"
   * acknowledgement against it. Cleared on the next copy; null when nothing has been
   * copied yet this session.
   */
  copiedSystem = signal<string | null>(null)

  /**
   * Click-to-copy on any derived coordinate row. Maintainer, 2026-08-26: "if users click
   * any coordinate display, copy that to clipboard, if you agree" - agreed, and it is the
   * genuinely useful direction here: reading MGRS back to a helicopter, or pasting a
   * position into a separate CAD/ICS system, is exactly what these read-only rows are FOR,
   * and retyping a 15-character grid reference by hand mid-incident is both slow and an
   * easy place to transpose a digit.
   *
   * Same `navigator.clipboard.writeText()` idiom the two Leaflet maps already use for their
   * own click-to-copy (mini-mapLeaflet.component.ts's onMouseClick, mapLeaflet's
   * storeLatLngInClipboard) rather than a new mechanism - including its catch, since
   * clipboard access can be refused (insecure context, or a permissions policy) and a
   * silent unhandled rejection would leave the scribe believing a copy happened.
   */
  // Widened from the coordinate-system literal union to a plain string 2026-08-26: the
  // Address/+Codes/Maidenhead rows reuse this exact copy mechanism now (they aren't real
  // coordinate systems - no activeSystem/formatSystem semantics - so they don't belong in
  // that union), and copiedSystem itself was already typed string | null.
  copyCoordinate(system: string, value: string): void {
    navigator.clipboard.writeText(value)
      .then(() => {
        this.copiedSystem.set(system)
      })
      .catch(err => {
        this.log.error(`${system} NOT copied to clipboard, error: ${err}`, this.id)
      })
  }

  private formatSystem(system: CoordinateFormat): string {
    switch (system) {
      case 'DD': {
        const { latI, latF, lngI, lngF } = this.ddModel()
        // The same two string parts onDdChg() rebuilds from (leading zeros kept), so the
        // display and the value a real edit here would produce stay identical on purpose.
        return `${latI}.${latF}°, ${lngI}.${lngF}°`
      }
      case 'DDM': {
        const { latDdmD, latDdmM, latDdmQ, lngDdmD, lngDdmM, lngDdmQ } = this.ddmModel()
        return `${latDdmD}° ${latDdmM.toFixed(2)}' ${latDdmQ}, ${lngDdmD}° ${lngDdmM.toFixed(2)}' ${lngDdmQ}`
      }
      case 'DMS': {
        const { latD, latM, latS, latQ, lngD, lngM, lngS, lngQ } = this.dmsModel()
        return `${latD}° ${latM}' ${Math.round(latS)}" ${latQ}, ${lngD}° ${lngM}' ${Math.round(lngS)}" ${lngQ}`
      }
      case 'MGRS': {
        const { gridRef, easting, northing } = this.mgrsModel()
        return `${gridRef} ${String(easting).padStart(5, '0')} ${String(northing).padStart(5, '0')}`
      }
      case 'UTM': {
        const { zone, hemisphere, easting, northing } = this.utmModel()
        return `${zone}${hemisphere} ${easting} ${northing}`
      }
    }
  }

  /**
   * Any user change to a coordinate representation (above), an address lookup (below), or the
   * parent handing us a new @Input() location (via ngOnChanges) funnels through here: update
   * the canonical lat/lng - which every DD/DDM/DMS linkedSignal above recomputes from
   * automatically - resolve/derive the address, and notify the parent.
   *
   * NOTE: gets called before ngOnInit, during parent's construction
   * !TODO: Validate values here or in calling routines?
   *
   * @param newLocation: LocationType
   */
  newLocationToFormAndEmit(newLocation: LocationType) {

    this.canonical.set({ lat: newLocation.lat, lng: newLocation.lng })
    this.lastEmitted = { lat: newLocation.lat, lng: newLocation.lng }

    let address = ''
    const said = this.addressTyped ? this.addressModel().trim() : ''
    if (newLocation.derivedFromAddress) {
      address = newLocation.address
      this.updateDerivedLocations(newLocation)
    } else if (said) {
      // E-302: the point moved (map click, typed coordinates) but the scribe's words stay the address; the
      // lookup only labels the line underneath.
      newLocation = { ...newLocation, address: said, derivedFromAddress: true }
      address = said
      this.DDToAddress(newLocation, true)
    } else {
      // Async routine to geocode from lat/lng & update location.address. Kicked off here
      // (not awaited) rather than blocking the emit below - a slow geocode isn't blocking
      // anything critical since the mini-map only needs lat/lng, not the address text.
      // DDToAddress (asynchroniously) calls updateDerivedLocations() too
      this.DDToAddress(newLocation)
    }
    // Set model value - which updates the display & is the only place the current address is kept.
    this.addressModel.set(address)

    // Emit new location event to parent: so it & any children can react
    this.locationChange.emit(newLocation)
  }

  /**
   * Update labels with derived locations
   * Derived Plus Codes are not stored on LocationType: they are recomputed from lat/lng (#81).
   *
   * @param location
   */


  chkPCodes(pCode: string) {
    if (pCode.length) {
      if (!this.settings) {
        this.log.error(`this.settings was null in chkPCodes`, this.id)
        return
      }

      // Bug, found live 2026-08-27: Google's own standard shareable format for a SHORT code
      // is "CODE LOCALITY" (e.g. "FGPM+MC7 Vashon, Washington") - a short code is meaningless
      // without a reference point, and that's the normal way one gets shared/typed. Every
      // character of a locality (letters, spaces, commas) fails OpenLocationCode's own
      // alphabet check, so isValid() below returned false for the FULL string and this
      // function did nothing at all - no error, no fallback, just silence. The locality text
      // isn't needed anyway: isShort() below already recovers a short code against this
      // mission's own defLat/defLng, a better reference for an incident-local code than
      // geocoding the locality text would be. Only the first token (the code itself - never
      // contains whitespace) is validated/decoded; anything after the first space is ignored.
      pCode = pCode.trim().split(/\s+/)[0]

      if (OpenLocationCode.isValid(pCode)) {
        if (OpenLocationCode.isShort(pCode)) {
          pCode = OpenLocationCode.recoverNearest(pCode, this.settings.defLat, this.settings.defLng)
        }

        // Following needs a full (Global) code
        let coord = OpenLocationCode.decode(pCode)
        //let newLocation: LocationType =
        this.newLocationToFormAndEmit({ lat: coord.latitudeCenter, lng: coord.longitudeCenter, address: "", derivedFromAddress: false })
      }

      else {
        //    document.getElementById("addressLabel")!.innerHTML = " is <strong style='color: darkorange;'>Invalid </strong> Try: " + this.settings.defPlusCode
        //document.getElementById("pCodeGlobal")!.innerHTML = this.settings.defPlusCode
      }
    }
  }

  /**
   * Sprint H: Maidenhead grid locators typed into the shared address/Plus-Code
   * field, detected the same way Plus Codes already are - checked by
   * onAddressChg() before the street-address fallback. No dedicated input field: a
   * 4-6 character token has no natural sub-component split the way DD/DDM/DMS do.
   */
  chkMaidenhead(locator: string) {
    const converted = MaidenheadToDD(locator)
    if (!converted) {
      this.log.verbose(`chkMaidenhead: MaidenheadToDD rejected "${locator}"`, this.id)
      return
    }
    this.newLocationToFormAndEmit({ lat: converted.lat, lng: converted.lng, address: "", derivedFromAddress: false })
  }

  updateDerivedLocations(location: LocationType) {

    // DDToAddress already called - if needed...
    //if (location.derivedFromAddress == false) {
    // Updates location.address, but asyncronously
    //let result = this.DDToAddress(location)
    //}

    //! duplicate code in ChkPCode()!
    // Check for https://github.com/google/open-location-code (works offline!)
    let pCode = OpenLocationCode.encode(location.lat, location.lng, 11); // OpenLocationCode.encode using default accuracy returns an INVALID +Code!!!
    let fullCode
    if (pCode.length) {
      if (OpenLocationCode.isValid(pCode)) {
        if (OpenLocationCode.isShort(pCode)) {
          // Recover the full code from a short code:
          fullCode = OpenLocationCode.recoverNearest(pCode, this.settings.defLat, this.settings.defLng)
        } else {
          fullCode = pCode
          // Attempt to trim the first characters from a code; may return same innerText...
          pCode = OpenLocationCode.shorten(fullCode, this.settings.defLat, this.settings.defLng)
        }
        // E-item, 2026-08-27: dropped the "+Code: " prefix this string used to open with -
        // the row's own "+Codes:" label (location.component.html) already says that, so the
        // two together used to read "+Codes: +Code: 8QQ2..." on screen.
        this.derivedPCodes.set(`${pCode}  Global: ${fullCode}`)
      } else {
        this.log.verbose(`Invalid +PlusCode: ${pCode}`, this.id)
        this.derivedPCodes.set("Unable to get code")
      }
    }

    this.derivedAddress.set(location.address)

    // Sprint H: no dedicated Maidenhead input field, but the position is still shown
    // here as a derived readout.
    this.derivedMaidenhead.set(DDToMaidenhead(location.lat, location.lng))

    // E-48(1): now that every line above has real text, the block can actually be shown.
    // Deliberately after the .set() calls above, not before - the elements themselves stay
    // permanently in the DOM (see the --hidden class on .enter__Where-Results in the
    // template) rather than an @if, specifically so this ordering can't race a render.
    this.showDerived.set(true)
  }

  /**
   * E-104 (2026-08-26): Address/+Codes/Maidenhead, same click-to-copy button-row treatment
   * as the coordinate-system rows above them. Real signals now, not `setDerivedText()`'s
   * direct DOM writes - the previous approach existed because these are async-geocode
   * results with no model behind them, and a signal write from a callback that outlives its
   * component is harmless (unlike the old `getElementById(...)!.value = text`, which threw
   * "Cannot set properties of null" if the view was gone - see git history), so converting
   * these removes a defensive-guard requirement rather than just changing style.
   */
  derivedAddress = signal('')
  derivedPCodes = signal('')
  derivedMaidenhead = signal('')

  /**
   * E-48(1): blanks every derived readout. Separate from hiding the block, because the
   * elements stay in the DOM either way (see the template's --hidden class) - leaving the
   * previous report's text sitting in a hidden element would mean it flashes back the
   * moment the block is shown again for the next report.
   */
  private clearDerivedText() {
    this.derivedAddress.set('')
    this.derivedPCodes.set('')
    this.derivedMaidenhead.set('')
  }


  /**
   * NOTE: following sets DERIVED address
   * in an async manner (i.e., doesn't return an address)
   * Requires Internet access!
   *
   * !TODO: Should it ALSO emit an updated location?!
   *
   * @param location: locationType
   * @returns
   */
  DDToAddress(location: LocationType, labelOnly = false) {
    // assert(!location.derivedFromAddress)
    if (location.derivedFromAddress && !labelOnly) {
      this.log.error(`DDToAddress got a primary address NOT needing derivation!`, this.id)
    }

    // Only show address in model during location emition
    // This control ONLY shows main address if user entered it there
    // for this control/widget: differentiate between derived & 'primary' or user entered addresses
    if (!labelOnly) this.addressModel.set("")

    this.geocodingProvider.reverseGeocode(location.lat, location.lng)
      .then((result) => {
        // Async: likely runs after subroutine returns
        if (!result.found) {
          this.log.warn(`The address lookup for a position failed: ${result.error}`, this.id)
          return
        }


        // E-302: the line underneath is always marked "(inferred)" when it comes from this lookup.
        this.derivedAddressInferred.set(true)
        if (labelOnly) {
          this.updateDerivedLocations({ ...location, address: result.address })
          this.derivedAddressInferred.set(true)
          return
        }
        location.address = result.address
        this.updateDerivedLocations(location)
        this.derivedAddressInferred.set(true)

        this.locationChange.emit(location)
      })
    return ("No immediate address available: await the result!")
  }

  /**
   * The Address box changed. A +Code or Maidenhead locator is an exact position, so it moves the point. Street
   * text is what was said: leaving the box keeps it as the report's address and leaves the point alone (E-302);
   * `lookUp` (Enter, or the search button) asks the geocoder and moves the point to its answer.
   */
  onAddressChg(lookUp = false) {
    const newAddress = this.addressModel().trim()

    if (!newAddress.length) {
      this.addressTyped = false
      return
    }

    if (newAddress.includes("+")) {
      this.chkPCodes(newAddress)
    } else if (isMaidenhead(newAddress)) {
      this.chkMaidenhead(newAddress)
    } else if (lookUp) {
      this.chkStreetAddress(newAddress)
    } else {
      this.keepSaidAddress(newAddress)
    }
  }

  /** E-302: the scribe's words become the report's address; the position stays exactly where it is. */
  private keepSaidAddress(text: string): void {
    this.addressTyped = true
    const { lat, lng } = this.canonical()
    const loc: LocationType = { lat, lng, address: text, derivedFromAddress: true }
    this.lastEmitted = { lat, lng }
    this.locationChange.emit(loc)
  }

  //----------------------------------------------------------------------------------------
  // Address stuff

  chkStreetAddress(addrText: string) {

    this.geocodingProvider.geocodeAddress(addrText).then((result) => {
      if (!result.found) {
        this.log.warn(`The address lookup for typed text failed: ${result.error}`, this.id)
        return
      }

      let enteredLocation: LocationType = {
        lat: result.lat,
        lng: result.lng,
        address: addrText,
        derivedFromAddress: true
      }

      this.newLocationToFormAndEmit(enteredLocation)
    })
  }

  ngOnDestroy() {
    this.missionSubscription?.unsubscribe()
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
  }
}
