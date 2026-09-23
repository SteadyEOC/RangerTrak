import { Observable, ReplaySubject } from 'rxjs'
import { DEFAULT_CHECK_IN_INTERVAL_MIN } from '../overdue'

import { Injectable, OnInit, Optional, signal, SkipSelf } from '@angular/core'

import * as packageJson from '../../../../package.json'
import { RadioLogStatusType, LogService, MissionType } from './'
import {
  DEFAULT_RADIO_LOG_STATUSES, DEFAULT_LOCATION_TYPES, DEFAULT_RECIPIENT_OPTIONS_213,
  MISSION_SCHEMA_VERSION, DEFAULT_OP_PERIOD_HOURS, migrateMission
} from './mission-migration'

@Injectable({ providedIn: 'root' })
export class MissionService implements OnInit {

  private id = 'Mission Service'
  private storageLocalName = 'appSettings'
  // settingsSignal is the single source of truth for state (replaces the old
  // BehaviorSubject entirely). settingsReplay$ is a thin, synchronously-fed
  // notification layer for existing Observable-based consumers - NOT state
  // storage. It exists because toObservable() bridges signals to Observables
  // via an effect(), which schedules emissions on the next microtask rather
  // than synchronously like BehaviorSubject.next() did; several consumers
  // (and the Section 12/Sprint 1 characterization tests, which must stay
  // green *unmodified*) depend on synchronous emission. ReplaySubject(1),
  // not BehaviorSubject, keeps the "no BehaviorSubject" DoD literally true
  // while preserving replay-on-subscribe semantics for late subscribers.
  private settingsSignal = signal<MissionType>(undefined as unknown as MissionType)
  private settingsReplay$ = new ReplaySubject<MissionType>(1)
  /** Shared with MissionComponent's start-time handler - see DEFAULT_OP_PERIOD_HOURS. */
  private defOpPeriodLength = DEFAULT_OP_PERIOD_HOURS // hours

  /** Synchronous read of current settings. Single source of truth is settingsSignal. */
  public get settings(): MissionType {
    return this.settingsSignal()
  }

  /** Writes state to the signal and synchronously notifies Observable subscribers. */
  private setMission(value: MissionType) {
    this.settingsSignal.set(value)
    this.settingsReplay$.next(value)
  }

  constructor(@Optional() @SkipSelf() existingService: MissionService,
    private log: LogService
  ) {
    //! REVIEW: Gets called twice!!
    this.log.verbose(`======== constructor() ============`, this.id);

    if (existingService) {
      /**
       * see https://angular.io/guide/singleton-services
       * Use @Optional() @SkipSelf() in singleton constructors to ensure
       * future modules don't provide extra copies of this singleton service
       * per pg 84 of Angular Cookbook: do NOT add services to *.module.ts!
       */
      // Was `throwError(() => {...})` - the rxjs creation function, which only BUILDS an
      // observable. Nothing subscribed, so this guard never fired and five components quietly
      // ran their own MissionService for months (BUG-2). Throw for real.
      const msg = `MissionService has already been provided. It is providedIn:'root' - do not list it in a component's providers.`
      this.log.error(msg, this.id)
      throw new Error(msg)
    }

    // on page transition between Entry Screen or Google Maps pages ONLY (others use only static settings)

    //  ------------------------- SECRETS -------------------------------

    // We have a secrets file that is .gitignore - so never gets stored up at github
    // TODO: Maybe better is to ask user to enter THEIR API Keys on the settings page?
    // https://www.freecodecamp.org/news/how-to-securely-store-api-keys-4ff3ea19ebda/

    //  https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt   & https://www.crypto101.io/

    // https://github.com/mdn/dom-examples/blob/main/web-crypto/encrypt-decrypt/index.html



    /**
     * https://github.com/brix/crypto-js
     * https://cryptojs.gitbook.io/docs/
     * https://www.labnol.org/code/encrypt-decrypt-javascript-200307
     * const CryptoJS = require('crypto-js');

const encryptWithAES = (text) => {
  const passphrase = '123';
  return CryptoJS.AES.encrypt(text, passphrase).toString();
};

const decryptWithAES = (ciphertext) => {
  const passphrase = '123';
  const bytes = CryptoJS.AES.decrypt(ciphertext, passphrase);
  const originalText = bytes.toString(CryptoJS.enc.Utf8);
  return originalText;
};



*  or from https://jsbin.com/kofiqokoku/1/edit?html,js,output
<script src="http://crypto-js.googlecode.com/svn/tags/3.1.2/build/rollups/aes.js"></script>


var encrypted = CryptoJS.AES.encrypt("Message", "Secret Passphrase");

console.log(encrypted);
console.log(encrypted.toString());

var decrypted = CryptoJS.AES.decrypt(encrypted.toString(), "Secret Passphrase");

console.log(decrypted);
console.log(decrypted.toString(CryptoJS.enc.Utf8));

     */






    // NOTE: secrets.json used to be imported here and copied into a static
    // MissionService.secrets. That import inlined every key into main-*.js
    // (PRIVATE-Roadmap.md Section 9e) and, because secrets.json is gitignored,
    // made the project impossible to build from a clean clone - CI included.
    // Nothing read the static: its only consumer, gmap.component.ts, went with
    // the Google Maps removal. The Google geocoding key that survives is a
    // user-supplied value in localStorage (see mission.interface.ts), never
    // bundled.

    //  ------------------------- SETTINGS -------------------------------

    // populate this.settingsettings
    // Doesn't auto-update settings that are not exposed in the Settings Edit Component (e.g., version/AppName!)
    let localStorageMission = localStorage.getItem(this.storageLocalName)
    let needMission = this.settings == undefined
    if (needMission) {
      this.log.info("Get App Settings...", this.id)
      try {
        // E-89/E-90 (2026-08-25): was a substring check for "defPlusCode" - that field is
        // now removed from MissionType (dead control, never read by anything), so a
        // freshly-saved settings object would never contain it again, and this check would
        // never find a real settings blob "well-formed" - falling back to defaults on every
        // load despite real data sitting right there in localStorage. "schemaVersion" is
        // NOT a safe replacement: a genuine pre-Sprint-E (v0) object has no schemaVersion at
        // all - that absence is exactly what migrateMission() treats as "version 0" and
        // migrates forward - so requiring it here would reject the one shape the migration
        // path most needs to handle. "defLat" has been part of every settings shape since
        // before schema versioning existed and survives every migration step untouched.
        if (localStorageMission != null && localStorageMission.indexOf("defLat") > 0) {
          // Migrate BEFORE publishing: subscribers (and the Settings form) must never see a
          // pre-migration shape. See mission-migration.ts. The other entry point that can
          // introduce foreign settings is Restore mission - backup.service.ts migrates there too.
          // initMission() supplies the backfill source, so a stored object written before a
          // field existed gains it rather than breaking the Settings page (BUG-3).
          this.setMission(migrateMission(JSON.parse(localStorageMission), this.initMission()))
          this.log.verbose("Initialized App Settings from localstorage", this.id)
          needMission = false
        }
      } catch (error: any) {
        this.log.verbose(`Unable to parse settings in localstorage (${localStorageMission}), so will be renamed out of the way. Error: ${error.name}; msg: ${error.message}`, this.id);
        // localStorage.removeItem(this.storageLocalName) /// will get overwritten anyway
        localStorage.setItem(this.storageLocalName + '-BAD', localStorageMission!)
      }
    }
    if (needMission) {
      this.setMission(this.initMission())
    }

    // REVIEW: Above comes up with an old version # (if loaded from localStorage), so do this after the above
    // package.json has version: https://www.npmjs.com/package/standard-version: npm run release
    let packageAsString = JSON.stringify(packageJson)
    let packageAsJson = JSON.parse(packageAsString)
    //this.version = packageAsJson.version
    //MissionService.version = packageAsJson.version
    this.settings.version = packageAsJson.version
    // Routine startup information, not a fault. Logging it at error level put a red entry
    // at the top of the Log page on every single load and buried the real errors under it.
    this.log.info(`Settings version (from package.json) set to: ${packageAsJson.version} `, this.id)

    // publish settings to subscribers
    this.updateMission(this.settings)

    // REVIEW: following forces garbage collection of package.json, for security? (would happen at end of constructor too)
    packageAsString = ''
    packageAsJson = null

    this.log.verbose('out of constructor', this.id)
  }

  ngOnInit() {
    this.log.verbose(`ngOnInit()`, this.id);


    if (window.isSecureContext) {
      this.log.verbose(`Application running in secure context`, this.id)

      // https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt
      // https://mdn.github.io/dom-examples/web-crypto/encrypt-decrypt/index.html
      // https://github.com/mdn/dom-examples/blob/main/web-crypto/encrypt-decrypt/index.html
      // https://info.townsendsecurity.com/rsa-vs-aes-encryption-a-primer

      // https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
      // Page is a secure context so service workers are now available
      //navigator.serviceWorker.register("/offline-worker.js").then(() => {  ...  })
    }

    this.sha256("hello").then(digestValue => {
      console.error(` #### SECRET Digest is: ${digestValue}`)
    });

  }

  async sha256(str: string) {
    const encoder = new TextEncoder();
    const encdata = encoder.encode(str);
    const buf = await crypto.subtle.digest("SHA-256", encdata);
    return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
  }


  /**
   * Called by Mission Component when user wants to reset
   */
  public ResetDefaults(): MissionType {
    this.log.verbose(`Settings are being restored to their initial (hardcoded) values. Please re-enter mission info as desired.`, this.id)
    this.updateMission(this.initMission())
    return this.settings
  }

  /**
   *   populate Field Report Statuses
   *
   */
  /** Factory defaults. Also the backfill source for migrateMission() - see BUG-3. */
  public initMission(): MissionType { // settings: MissionType
    //original hardcoded defaults... not updated until form is submitted... Settings.component.ts' form doesn't allow editing of all values
    this.log.verbose("Initialize App Settings from hardcoded values", this.id)

    let dt = new Date()
    let endDt = new Date()
    endDt.setHours(Number(dt.getHours()) + this.defOpPeriodLength)
    this.log.verbose(`OpPeriod: ${dt.toLocaleString("en-US")}, plus ${this.defOpPeriodLength} hours = ${endDt.toLocaleString("en-US")} `, this.id)

    return {
      schemaVersion: MISSION_SCHEMA_VERSION,
      settingsName: '', // FUTURE: Use if people want to load and saveas, or have various 'templates'
      settingsDate: dt, // when last created/edited...

      mission: '',
      event: '',
      eventNotes: '',
      opPeriod: '',
      opPeriodStart: dt,
      opPeriodEnd: endDt,

      application: 'RangerTrak',
      // Raised live 2026-08-30: was a literal '0' placeholder with a comment saying the
      // constructor patches it in afterward - true only the FIRST time initMission() runs
      // (app startup, when no mission exists yet). ResetDefaults() calls initMission() again
      // later and nothing re-patches it that time, so 'Reset mission to defaults' left the
      // footer showing 'Version 0' until the next full page load (e.g. loading sample data,
      // which reloads the page) re-ran the constructor's own patch. Read directly here
      // instead, so this is correct regardless of which caller asks for a fresh mission.
      version: packageJson.version,
      debugMode: false,

      defLat: 47.4472,
      defLng: -122.4627,  // Vashon EOC!
      allowManualPinDrops: false,
      googleGeocodingApiKey: '',

      showDD: true,
      showDDM: true,
      showDMS: true,
      // Raised live, 2026-08-26. These gate which coordinate systems Entry's format
      // switcher offers (E-104, 2026-08-26 - location.component.ts's activeSystem/
      // availableSystems()) - MGRS/UTM off by default keeps a fresh install's switcher to
      // the three formats most SAR volunteers already read (DD/DDM/DMS), with MGRS/UTM one
      // Mission Settings checkbox away for missions that use them. (Originally written
      // against the older "show every system at once" design, since replaced - the
      // defaults themselves are unchanged, only what they now control.)
      showMGRS: false,
      showUTM: false,
      showMaidenhead: true,

      leaflet: {
        defZoom: 17,  // or just zoom to bounds?
        markerScheme: '',
        overviewDifference: 5,
        overviewMinZoom: 5,
        overviewMaxZoom: 16
      },

      maplibre: {
        defZoom: 17,  // used? or just zoom to bounds?
        markerScheme: '',
        overviewDifference: 5,
        overviewMinZoom: 5,
        overviewMaxZoom: 16
      },

      imageDirectory: "./assets/imgs/",    //! WARNING: Hardcoded & potential SECURITY risk.
      defRadioLogStatus: 0, // which of the following array entries to use as the default value
      //? FUTURE: Consider replacing "Color" with "CSS_Style" to allow more options?
      //? FUTURE: Consider adding contrasting 'shadow color' for nice display on entry form
      // https://en.wikipedia.org/wiki/Web_colors#Extended_colors
      // https://en.wikipedia.org/wiki/Web_colors#Color_table
      // https://developer.mozilla.org/en-US/docs/Web/CSS/color_value#fully_saturated_colors
      // https://m3.material.io/styles/icons/applying-icons#ebb3ae7d-d274-4a25-9356-436e82084f1f
      // https://fonts.google.com/icons
      // Sprint E: these are semantic keys resolving to --rt-status-*, not raw CSS colors.
      // The old CSS named colors (LightYellow, Chartreuse, Aquamarine, Silver...) were
      // painted as TEXT on the Entry status radios and measured as low as 1.07:1 - a fresh
      // install shipped inaccessible, not just upgraded ones. See mission-migration.ts,
      // which maps the old values forward for existing users.
      radioLogStatuses: [...DEFAULT_RADIO_LOG_STATUSES],
      // fieldReportKeywords: [''],  // Future...could also just search notes field
      recipientOptions213: [...DEFAULT_RECIPIENT_OPTIONS_213],
      idFieldLabel: 'ID',
      // E-118: 30 min x OVERDUE_RED_MULTIPLE (3) = red at 90 minutes, the stated default.
      checkInIntervalMin: DEFAULT_CHECK_IN_INTERVAL_MIN,
      locationTypes: [...DEFAULT_LOCATION_TYPES],
      // E-87 Stage 1: off, blank, by default - a fresh install never publishes anywhere
      // until a mission explicitly opts in and names a server.
      commandPostEnabled: false,
      commandPostServerUrl: '',
      // Maintainer ask (2026-09-22): default OFF - see MissionType.autoPrint213's own comment
      // for why silently inheriting an auto-print-every-213 behavior would be the wrong default.
      autoPrint213: false,
    }
  }

  /**
  * rewrite field reports to localStorage & notify observers
  */
  public updateMission(newMission: MissionType) {
    // Do any needed sanity/validation here
    //debugger
    localStorage.setItem(this.storageLocalName, JSON.stringify(newMission))
    this.setMission(newMission)
    this.log.verbose(`Notified subscribers of new Application Settings ${JSON.stringify(newMission)} `, this.id)

    //! Is this proper?!
    //this.log.verbose(`updateMission: Reloading window!`, this.id)
    //window.location.reload() creates endless cycle!
  }

  /**
   * Expose Observable to 3rd parties, but not the actual subject (which could be abused)
   */
  public getMissionObserver(): Observable<MissionType> {
    return this.settingsReplay$.asObservable()
  }

}
