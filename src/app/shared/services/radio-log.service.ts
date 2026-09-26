import { Observable, Observer, of, ReplaySubject, Subscription, throwError } from 'rxjs'

import { HttpClient } from '@angular/common/http'
import {
  Injectable, OnDestroy, OnInit, Optional, Pipe, PipeTransform, signal, SkipSelf, WritableSignal
} from '@angular/core'

import {
  RadioLogStatusType, RadioLogType, RadioLogEntryType, LogService, RangerType,
  MissionService, MissionType
} from './'
// ADR D-42: versioned storage seam for radio log entries. Direct import, not via the barrel,
// to avoid a cycle - the barrel re-exports this service.
import { migrateRadioLog } from './radio-log-migration'
import { rehydrateDateFields } from './json-dates'
// Direct path, not the barrel: a SERVICE used as a DI token through shared/services/index.ts
// is unresolvable to the compiler ("no suitable injection token") - the same reason
// rangers.component.ts imports RangerPhotoService directly instead of via './'.
import { RangerService } from './ranger.service'
// E-122 Phase 2a: field reports are PII, and now live behind RecordStore (in-memory +
// IndexedDB) rather than directly in localStorage. Direct import, same reasoning as the
// RangerService import above.
import { recordStore } from '../storage/record-store'
// E-114 Phase 0: resolving a self-typed credential (a zero-provisioning lite device has no
// roster of its own) against THIS device's roster reuses the exact comparison
// normalizeRangerIds() already applies everywhere else - not a second matching rule.
import { normalizeRangerId } from './ranger-migration'
// E-114 Phase 1: buildReportPacketText() below - see its own doc comment for why the packet
// assembly is centralized here rather than duplicated in every caller.
import { buildReportPacket, reportPacketFilename } from '../export/report-packet'
import * as packageJson from '../../../../package.json'

//import {  } from './ranger.interface'



// TODO: Update server with new reports:  https://angular.io/tutorial/toh-pt6#heroes-and-http

// 2026-08-31: renamed from field-report.service.ts / FieldReportService - a naming holdover
// from before the page itself was renamed Reports -> Radio Log (0.75.0). Class/method/field
// names all follow, including `storageLocalName` (below) - the app has no real users yet
// ([[no-real-users-yet-rename-freely]]), so there is no stored data to orphan by changing it.

//, deps: [LogService, RangerService, LogService]
@Injectable({ providedIn: 'root' })
export class RadioLogService {

  private id = 'Radio Log Service'

  private radioLog!: RadioLogType
  // radioLogSignal is the single source of truth for state.
  // radioLogReplay$ is a thin, synchronously-fed notification layer for
  // existing Observable consumers - see the equivalent, more-detailed
  // comment in mission.service.ts for why (toObservable()'s effect-based
  // bridge is asynchronous; several consumers need synchronous emission).
  // Like RangerService's `rangers`, `radioLog` is mutated in place
  // (push/extend/etc.) rather than reassigned; updateRadioLogAndPublish()
  // is the single point that syncs its current contents out.
  private radioLogSignal!: WritableSignal<RadioLogType>
  private radioLogReplay$ = new ReplaySubject<RadioLogType>(1)

  // REVIEW: No need to enable subscription to selectedRadioLog as they are
  // auto-saved on evey selection and user is single-threaded.
  // Otherwise move to maps which THEN grab the new values.
  private selectedRadioLog!: RadioLogType

  private missionSubscription!: Subscription
  private settings!: MissionType

  public rangers: RangerType[] = []

  private storageLocalName = 'radioLog'
  private serverUri = 'https://localhost:4000/products' // FUTURE:
  private boundsMargin = 0.0025

  // https://angular.io/guide/architecture-services#providing-services: singleton or multiple service instances?!
  //! REVIEW: Field & Ranger Services BOTH call constructors twice!!
  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private log: LogService,
    private httpClient: HttpClient,
    @Optional() @SkipSelf() existingService: RadioLogService,
  ) {
    if (existingService) {
      /**
       * see https://angular.io/guide/singleton-services
       * Use @Optional() @SkipSelf() in singleton constructors to ensure
       * future modules don't provide extra copies of this singleton service
       * per pg 84 of Angular Cookbook: do NOT add services to *.module.ts!
       */
      throwError(() => {
        console.error(`This singleton service has already been provided in the application. Avoid providing it again in child modules.`)
        new Error(`This singleton service has already been provided in the application. Avoid providing it again in child modules.`)
      })
    }

    this.log.verbose("======== Constructor() ============", this.id)
    //! REVIEW: this.log.verbose(`Constructor call stack (NOT an error: why called twice?): ${new Error().stack}`, this.id)

    // Subscribe to Settings BEFORE loading reports: MissionService replays its current
    // value synchronously, so this populates this.settings first. Loading first meant a
    // fresh install built its empty RadioLog with version '0' (initEmptyRadioLog
    // falls back when settings are missing), which then failed the version check below
    // and logged a bogus "does NOT match" error on every virgin start.
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.log.excessive('Received new Settings via subscription.', this.id)
        this.checkRadioLogVersion()
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('Settings Subscription complete', this.id)
    })

    this.radioLog = this.loadRadioLogFromLocalStorage()

    this.log.info(`Got v.${this.radioLog.version} for event: ${this.radioLog.event} on  ${this.radioLog.date} with ${this.radioLog.numReport} Field Reports from localstorage`, this.id)

    // REVIEW: bounds actually needs to be an Object, not getting done this a waitForAsync, right?!
    this.recalcRadioLogBounds(this.radioLog)  // Should be extraneous...
    this.radioLogSignal = signal(this.radioLog)
    this.updateRadioLogAndPublish()
  }


  /**
   * Compares the app version stamped on the stored radio log against the currently
   * running app version.
   *
   * Investigated 2026-08-31 (roadmap backlog item, "latent gap: the check never actually
   * fires on startup"): true, but NOT fixed here on purpose. `version` is the raw app
   * version string (`package.json`), which changes on every single deploy - since "no
   * upgrade logic implemented yet" (this function's own log line already says so), a
   * mismatch is the NORMAL state after any release, for every returning user, not a real
   * anomaly. Making this run on the guaranteed-to-mismatch startup path would turn a silent
   * no-op into a `log.error` on nearly every session - worse than today's gap, not better.
   * Left wired only from the settings subscription's `next` (a live mid-session settings
   * change, comparatively rare) until this compares against something meaningful - a real
   * schema/data version, not the app's own release string.
   */
  private checkRadioLogVersion(): void {
    if (!this.radioLog || !this.settings) { return }

    if (this.radioLog.version == this.settings.version) {
      this.log.excessive('Application version matches version used to store Field Reports.', this.id)
    } else {
      this.log.error(`Application version ${this.settings.version} does NOT match version used to store Field Reports: ${this.radioLog.version}. No upgrade logic implemented yet...`, this.id)
    }
  }

  /**
   * Load any existing radio log from browser's Local Storage
   * FUTURE: If RadioLogType elements/structure changes in a future version, upgrade to that
   * @returns
   */
  private loadRadioLogFromLocalStorage(): RadioLogType {
    // E-122 Phase 2a: through RecordStore now, not localStorage directly - field reports can
    // carry missing-person PII (ARCHITECTURE.md "Encryption: exports today, storage later").
    // Synchronous to this caller, same as localStorage.getItem() was.
    let localStorageFieldReports = recordStore.getItem(this.storageLocalName)

    if (localStorageFieldReports == null) {
      this.log.warn(`No Field Reports found in Local Storage. Will rebuild from defaults.`, this.id)
      return this.initEmptyRadioLog()
    }
    else if (localStorageFieldReports.indexOf("version") <= 0) {
      this.log.error(`Field Reports in Local Storage appear corrupted (no version #) & will be stored in Local Storage with key: '${this.storageLocalName}-BAD'. Will rebuild from defaults.`, this.id)
      recordStore.setItem(this.storageLocalName + '-BAD', localStorageFieldReports)
      return this.initEmptyRadioLog()
    } else {
      // ADR D-42 Phase 2: everything stored goes through migrateRadioLog(), which
      // stamps schemaVersion and is where any future transform will live. Returns null when
      // the payload is not a usable store, in which case we fall back to our own initializer
      // rather than have the migration duplicate what 'empty' means.
      //
      // NOTE the corruption check above is a naive indexOf('version') substring search over
      // raw JSON - same class of bug as [[settings-marker-field-trap]]. 'schemaVersion'
      // happens to contain that substring, which is luck rather than design; do not remove
      // the 'version' field without replacing that check with a structural test.
      return migrateRadioLog(JSON.parse(localStorageFieldReports)) ?? this.initEmptyRadioLog()
    }
  }

  /**
   * Create a fresh/new/default/initial radio log object
   */
  private initEmptyRadioLog() {

    //(property) RadioLogService.radioLog: RadioLogType
    //Type '{ version: string | undefined; date: Date; event: string; bounds: L.LatLngBounds; numReport: number; maxId: number; filter: string; logEntries: { id: number; callsign: string; lat: number | undefined; ... 4 more ...; note: string; }[]; }' is not assignable to type 'RadioLogType'.ts(2322)

    if (this.settings === undefined) {
      this.log.error(`this.Settings not yet set!`, this.id)
      //throwError(() => new Error(`this.Settings was not yet set in RadioLogService!!!!!`))
      //debugger
      //return null
    }

    return {
      version: this.settings ? this.settings.version : '0',
      date: new Date(),
      event: this.settings ? this.settings.event : '',
      bounds: { north: 89.9, south: -89.9, east: 179.9, west: -179.9 }, // whole world until recalcRadioLogBounds() runs
      numReport: 0,
      maxId: 0,
      filter: '', // All reports or not? Guard to ensure a subset never gets writen to localstorage?
      logEntries: []
    }
  }

  /**
   * Expose Observable to 3rd parties, but not the actual subject (which could be abused)
   */
  public getRadioLogObserver(): Observable<RadioLogType> {
    return this.radioLogReplay$.asObservable()
  }

  /**
   * Synchronous read of the current radio log (e.g. for export/backup).
   * Prefer getRadioLogObserver() for anything reactive.
   */
  public getCurrentRadioLog(): RadioLogType {
    return this.radioLog
  }

  /**
   * Replaces the whole radio log wholesale (e.g. restoring from a mission
   * backup). `newRadioLog.bounds` is ignored if present - bounds are
   * always recalculated fresh, exactly as the constructor already does on
   * every normal load.
   */
  public replaceAllRadioLog(newRadioLog: Omit<RadioLogType, 'bounds'>) {
    this.radioLog = { ...newRadioLog, bounds: this.radioLog.bounds }
    this.recalcRadioLogBounds(this.radioLog)
    this.updateRadioLogAndPublish()
  }

  /**
   * Update localStorage with the new radio log & notify observers
   */
  private updateRadioLogAndPublish() {
    // Do any needed sanity/validation here
    if (this.radioLog.numReport != this.radioLog.logEntries.length) {
      this.log.error(`this.radioLog.numReport=${this.radioLog.numReport} != this.radioLog.logEntries.length ${this.radioLog.logEntries.length}`, this.id)
      this.radioLog.numReport = this.radioLog.logEntries.length
    }

    // E-122 Phase 2a: through RecordStore now (see loadRadioLogFromLocalStorage()'s own
    // comment) - synchronous to this caller, so nothing else in this method changes.
    recordStore.setItem(this.storageLocalName, JSON.stringify(this.radioLog))

    this.log.excessive(`New radio log is available to observers...`, this.id)
    // Signal gets a fresh copy for the same reason as RangerService.rangers:
    // this.radioLog is mutated in place, so .set() with the same
    // reference would be a no-op under the signal's default equality check.
    this.radioLogSignal.set({ ...this.radioLog })
    this.radioLogReplay$.next(this.radioLog)
  }

  /**
   * User has submitted a new radio log entry: store it into localstorage and publish to any subscribers
   *
   * @param formData
   * @returns
   */
  public addRadioLogEntry(formData: string) {
    this.log.info(`Got new radio log entry: ${JSON.stringify(formData)}`, 'RadioLogService')

    // EntryComponent hands this over as JSON.stringify(mergedFormValue()) - a deliberate
    // deep clone - so `date` arrives here as an ISO STRING even though RadioLogEntryType
    // declares it Date, and even though nothing has touched localStorage yet. Restoring it
    // at this boundary is what makes a locally-typed report indistinguishable from a
    // loaded one; without it, two reports typed in a single fresh session were enough to
    // make buildIcs309Log() throw. See json-dates.ts.
    let newReport: RadioLogEntryType = rehydrateDateFields(
      JSON.parse(formData) as RadioLogEntryType, //"[object Object]" is not valid JSON
      ['date', 'revisedAt', 'printedAt'])
    newReport.id = this.radioLog.maxId++
    this.radioLog.numReport++
    this.radioLog.logEntries.push(newReport)

    // Recalculate rather than widen the existing box (this used to call Leaflet's
    // LatLngBounds.extend()). Two update paths that disagreed - extend() applied no
    // broadening margin - was D-22; one path means one answer, and the array is small
    // enough that a full pass costs nothing.
    this.recalcRadioLogBounds(this.radioLog)

    this.updateRadioLogAndPublish() // put to localStorage & update subscribers
    return newReport
  }

  /**
   * E-114 Phase 0: merges reports that ORIGINATED on a different device (arriving via a
   * Report Packet - E-114 §2) into this device's own log, without colliding on `id` - a
   * per-device sequential `id` is never trustworthy across devices (two devices' first
   * reports both produce `id 0`; see the roadmap's own identity-prerequisite write-up).
   *
   * Every ACCEPTED entry gets a brand-new `id` from THIS device's own `maxId`, exactly the
   * way `addRadioLogEntry()` already stamps one on a locally-typed report - a merged entry
   * never carries the sending device's `id` forward. Its ORIGINAL id only matters as half of
   * the dedup key (`sourceUid`, see `RadioLogEntryType`'s own doc comment) so importing the
   * same packet twice changes nothing.
   *
   * `reporterCredential` is the ranger's own agency-issued id, self-typed once on a
   * zero-provisioning lite device (E-114 §1a) - used to resolve a real `rangerUid` against
   * THIS device's roster. An entry that already carries its own `rangerUid` (a device
   * provisioned with a real roster) is trusted as-is and never needs it. No match (a
   * volunteer not yet in the roster) is not an error - `callsign` is kept and `rangerUid`
   * stays empty, the same "callsign matches no current ranger" case this app already
   * tolerates on a normal roster mismatch.
   */
  public mergeIncomingEntries(
    incoming: readonly RadioLogEntryType[],
    reporterCredential?: string,
  ): { added: number, skipped: number, rejected: number } {
    const resolvedCredentialId = normalizeRangerId(reporterCredential)
    const resolvedUid = resolvedCredentialId
      ? this.rangerService.rangers.find(r => normalizeRangerId(r.id) === resolvedCredentialId)?.uid
      : undefined

    const seen = new Set(
      this.radioLog.logEntries.map(e => e.sourceUid).filter((v): v is string => !!v))

    let added = 0
    let skipped = 0
    let rejected = 0

    for (const entry of incoming) {
      const reason = this.invalidIncomingEntryReason(entry)
      if (reason) {
        this.log.warn(`mergeIncomingEntries: rejected an entry (${reason}): ${JSON.stringify(entry)}`, this.id)
        rejected++
        continue
      }

      const identity = entry.rangerUid || resolvedCredentialId || 'unknown'
      const sourceUid = `${identity}:${entry.id}`

      if (seen.has(sourceUid)) {
        skipped++
        continue
      }

      // rehydrateDateFields, not a bare spread: a Report Packet is JSON, so `date`/
      // `revisedAt`/`printedAt` arrive as ISO STRINGS despite being typed Date.
      // invalidIncomingEntryReason() above already parses `date` to validate it, but
      // validating is not converting - without this the string was stored as-is and later
      // threw in buildIcs309Log()'s `a.date.getTime()`. See json-dates.ts.
      this.radioLog.logEntries.push(rehydrateDateFields({
        ...entry,
        id: this.radioLog.maxId++,
        rangerUid: entry.rangerUid || resolvedUid,
        sourceUid,
      }, ['date', 'revisedAt', 'printedAt']))
      seen.add(sourceUid)
      added++
    }

    if (added) {
      this.radioLog.numReport = this.radioLog.logEntries.length
      this.recalcRadioLogBounds(this.radioLog)
      this.updateRadioLogAndPublish()
    }

    this.log.warn(`mergeIncomingEntries: ${added} added, ${skipped} already present, ${rejected} rejected.`, this.id)
    return { added, skipped, rejected }
  }

  /**
   * E-114 Phase 1 (2026-08-31, maintainer's own live ask - "validation of incoming reports,
   * mainly proper timestamps, etc."). A Report Packet is trusted physical custody (D-40/D-35 -
   * the same model Setup files already ship under), not an untrusted upload, but it is still a
   * hand-carried FILE - one a text editor, a bad copy/paste, or a stale hand-edit can corrupt
   * before it ever reaches `mergeIncomingEntries()` above. Checks only the fields this app
   * actually recomputes FROM, algorithmically, on every merge - a bad `date` or `location`
   * doesn't just display wrong, it poisons `recalcRadioLogBounds()`'s min/max math (a single
   * `NaN` coordinate breaks every future bounds comparison against it) and this device's own
   * chronological ordering. Returns a short reason string for the log, or null when the entry
   * is fine. Deliberately per-entry, not whole-packet: one corrupted row in an otherwise-good
   * file should not cost every other genuine report in it (same "skip and count, never reject
   * outright" tolerance `mergeIncomingEntries()` already applies to a duplicate).
   */
  private invalidIncomingEntryReason(entry: RadioLogEntryType): string | null {
    if (typeof entry.id !== 'number' || !Number.isFinite(entry.id)) {
      return 'id is not a number'
    }
    if (typeof entry.callsign !== 'string' || typeof entry.status !== 'string') {
      return 'callsign or status is not text'
    }
    if (isNaN(new Date(entry.date).getTime())) {
      return `not a valid timestamp: ${JSON.stringify(entry.date)}`
    }
    if (!this.isValidCoordinate(entry.location)) {
      return 'location is missing or out of range'
    }
    if (entry.evidenceLocation && !this.isValidCoordinate(entry.evidenceLocation)) {
      return 'evidenceLocation is out of range'
    }
    return null
  }

  private isValidCoordinate(location: { lat: number, lng: number } | null | undefined): boolean {
    return !!location
      && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
      && Number.isFinite(location.lng) && location.lng >= -180 && location.lng <= 180
  }

  /**
   * E-114 Phase 1 (2026-08-31): the Report Packet payload for THIS device's current radio
   * log, factored out of RadioLogComponent's own original `onBtnBuildReportPacket()` so
   * EntryComponent can offer an identical "send my reports" action - EntryComponent is the
   * one screen a field-mode/lite device actually has access to (RadioLogComponent's own
   * route is hidden from it, see `fieldModeGuard`), so it needs its own way to hand off the
   * reports it filed. Only the DOM/share mechanics (Web Share vs. plain download) differ by
   * caller and stay local to each - see either component's own button handler.
   *
   * Returns null when there is nothing to send - both callers show the identical "no reports
   * yet" message either way, so this stays a decision this method makes once.
   */
  public buildReportPacketText(operator: string): { text: string; filename: string; count: number } | null {
    const entries = this.getCurrentRadioLog().logEntries
    if (!entries.length) {
      return null
    }

    // Same JSON.parse(JSON.stringify(...)) workaround backup.service.ts/mission-zip.ts
    // already use for "Should not import the named export ... from default-exporting module."
    const appVersion = JSON.parse(JSON.stringify(packageJson)).version

    const packet = buildReportPacket({
      entries,
      settings: this.settings,
      operator,
      appVersion,
    })
    return {
      text: JSON.stringify(packet, null, 2),
      filename: reportPacketFilename(packet.mission, packet.exportedAt),
      count: entries.length,
    }
  }

  /**
   * Persist edits made in place to existing entries - the Radio Log grid
   * binds directly to logEntries, so AG Grid's cell editing mutates these
   * very objects; all that was missing was writing them back out. Bounds are
   * recalculated because an edited lat/lng can move the map's extent.
   */
  public saveEditedRadioLog() {
    this.recalcRadioLogBounds(this.radioLog)
    this.updateRadioLogAndPublish()
  }

  public setSelectedRadioLogEntries(selection: RadioLogEntryType[]) {
    if (this.selectedRadioLog == null) {
      this.selectedRadioLog = this.initEmptyRadioLog()
      this.selectedRadioLog.filter = "As selected by user"
    }
    this.selectedRadioLog.logEntries = selection
    this.selectedRadioLog.numReport = selection.length
    this.recalcRadioLogBounds(this.selectedRadioLog)
    // Update - if subscribed...
  }

  public getSelectedRadioLogEntries(): RadioLogType {
    // TODO: Use setter & getters?, pg 452 Ang Dev w/ TS
    if (this.selectedRadioLog == null) {
      this.log.warn(`User hasn't selected any rows yet,
      so we're returning an empty array for the selected radio log!`, this.id)
      this.selectedRadioLog = this.initEmptyRadioLog()
      this.selectedRadioLog.filter = "As selected by user"
      this.selectedRadioLog.logEntries = []
      this.selectedRadioLog.numReport = 0
    }
    return this.selectedRadioLog
  }

  public deleteAllRadioLogEntries() {
    // TODO: reset header properties too?!
    this.radioLog.logEntries = []
    recordStore.removeItem(this.storageLocalName)
    // E-114 (2026-08-31): maxId is deliberately NOT reset any more (was `= 0` here, flagged
    // with its own "is this desired???"). Resetting let a brand-new, unrelated report reuse
    // an old display number after a clear-all - confusing on its own, worse once a printed/
    // cited 213 could reference "entry 3" meaning two different reports at different times.
    // Left monotonic per device instead - decided in the roadmap's E-114 write-up.
  }


  // ------------------ BOUNDS ---------------------------

  /**
   * recalcRadioLogBounds
   *
   * The single place radio log bounds are computed. Writes a plain
   * BoundsType - map engines convert it to their own type at the point of use.
   *
   * @param reports
   * @returns
   */
  recalcRadioLogBounds(reports: RadioLogType) {
    this.log.verbose(`recalcRadioLogBounds got ${reports.logEntries.length} field reports`, this.id)

    if (!this.settings) {
      this.log.error('this.settings is undefined', this.id)
      throwError(() => new Error('this.settings is undefined'))
      return
    }
    let north
    let west
    let south
    let east

    if (reports.logEntries.length) {
      north = reports.logEntries[0].location.lat
      west = reports.logEntries[0].location.lng
      south = reports.logEntries[0].location.lat
      east = reports.logEntries[0].location.lng

      // https://www.w3docs.com/snippets/javascript/how-to-find-the-min-max-elements-in-an-array-in-javascript.html
      // concludes with: "the results show that the standard loop is the fastest"

      for (let i = 1; i < reports.logEntries.length; i++) {
        if (reports.logEntries[i].location.lat > north) {
          north = reports.logEntries[i].location.lat //Math.round(reports.logEntries[i].location.lat * 10000) / 10000
        }
        if (reports.logEntries[i].location.lat < south) {
          south = reports.logEntries[i].location.lat //Math.round(reports.logEntries[i].location.lat * 10000) / 10000
        }
        if (reports.logEntries[i].location.lng > east) {
          east = reports.logEntries[i].location.lng //Math.round(reports.logEntries[i].location.lng * 10000) / 10000
        }
        if (reports.logEntries[i].location.lng < west) {
          west = reports.logEntries[i].location.lng //Math.round(reports.logEntries[i].location.lng * 10000) / 10000
        }
      }
      // Round to 4 decimal places
      north = Math.round(north * 10 ** 4) / 10 ** 4
      south = Math.round(south * 10 ** 4) / 10 ** 4
      east = Math.round(east * 10 ** 4) / 10 ** 4
      west = Math.round(west * 10 ** 4) / 10 ** 4
    } else {
      // no field reports yet! Rely on broadening processing below
      north = this.settings.defLat
      west = this.settings.defLng
      south = this.settings.defLat
      east = this.settings.defLng
    }

    // Broaden boundaries to minimum values
    this.log.info(`recalcRadioLogBounds got E:${east} W:${west} N:${north} S:${south} `, this.id)
    if (east - west < 2 * this.boundsMargin) {
      east += this.boundsMargin
      west -= this.boundsMargin
      this.log.info(`recalcRadioLogBounds BROADENED to E:${east} W:${west} `, this.id)
    }
    if (north - south < 2 * this.boundsMargin) {
      north += this.boundsMargin
      south -= this.boundsMargin
      this.log.info(`recalcRadioLogBounds BROADENED to N:${north} S:${south} `, this.id)
    }

    reports.bounds = { north, south, east, west }
    this.log.excessive(`New bounds: E: ${east};  N: ${north};  W: ${west};  S: ${south};  `, this.id)
  }

}
