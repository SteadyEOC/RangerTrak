import { Observable, Observer, of, ReplaySubject, Subscription, throwError } from 'rxjs'

import { HttpClient } from '@angular/common/http'
import {
  inject, Injectable, OnDestroy, OnInit, Optional, Pipe, PipeTransform, signal, SkipSelf, WritableSignal
} from '@angular/core'

import {
  RadioLogStatusType, RadioLogType, RadioLogEntryType, LogService, RangerType,
  MissionService, MissionType
} from './'
// ADR D-42: versioned storage seam for radio log entries. Direct import, not via the barrel,
// to avoid a cycle - the barrel re-exports this service.
import { migrateRadioLog, RADIO_LOG_ENTRY_DATE_FIELDS } from '../../domain/radio-log-migration'
import { rehydrateDateFields } from '../../domain/json-dates'
import { newUid } from '../../domain/uid'
import { bumpHighWater, nextHandledMark, nextMsgNo } from '../../domain/msg-no'
import type { MsgNoContext } from '../../domain/msg-no'
import { DevicePrefsService } from './device-prefs.service'
import { FieldModeService } from './field-mode.service'
import { mergeAttachmentRefs } from '../../domain/attachments'
import type { AttachmentRef } from '../../domain/attachments'
import { EntryMergeOptions, EntryMergeResult, mergeEntries } from '../../domain/entry-merge'
// Direct path, not the barrel: a SERVICE used as a DI token through shared/services/index.ts
// is unresolvable to the compiler ("no suitable injection token") - the same reason
// rangers.component.ts imports RangerPhotoService directly instead of via './'.
import { RangerService } from './ranger.service'
// E-194: deleting every entry also sweeps the attachment bytes nothing refers to any more.
import { AttachmentStoreService, sha256Hex } from './attachment-store.service'
import { MissionJournalService } from './mission-journal.service'
import { distinctLiveRefs, matchMedia, shareNames, stillRemote } from '../../domain/report-packet-files'
// E-122 Phase 2a: radio log entries are PII, and now live behind RecordStore (in-memory +
// IndexedDB) rather than directly in localStorage. Direct import, same reasoning as the
// RangerService import above.
import { recordStore } from '../storage/record-store'
// E-114 Phase 0: resolving a self-typed credential (a zero-provisioning lite device has no
// roster of its own) against THIS device's roster reuses the exact comparison
// normalizeRangerIds() already applies everywhere else - not a second matching rule.
import { normalizeRangerId } from '../../domain/ranger-migration'
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

  private attachmentStore = inject(AttachmentStoreService)
  private journal = inject(MissionJournalService)
  private devicePrefs = inject(DevicePrefsService)
  private fieldMode = inject(FieldModeService)

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

  // No subscription needed on selectedRadioLog: selections are auto-saved on every grid
  // selection change and the user is single-threaded. Maps pull the current value via
  // getSelectedRadioLogEntries() instead, whenever their own All/selected switch is flipped -
  // confirmed still the actual, correct mechanism by the #76 e2e coverage in tools/e2e.js.
  private selectedRadioLog!: RadioLogType

  private missionSubscription!: Subscription
  private settings!: MissionType

  public rangers: RangerType[] = []

  /**
   * 2026-09-28, John: increments each time a NEW radio log entry is added via
   * addRadioLogEntry() - deliberately separate from radioLogSignal (the whole log) so a
   * subscriber only interested in "a report was just submitted" (the navbar brand mark's
   * event-triggered pulse - see navbar.component.ts) doesn't have to diff two full log
   * objects to notice. Not incremented by merges/restores (mergeIncomingReports(),
   * replaceAllRadioLog()) - those are bulk/background operations, not "a scribe just
   * submitted one report."
   */
  public readonly reportSubmittedSignal = signal(0)

  /**
   * E-220 / D-68: message numbers the LAST merge found already on a different entry here (two devices
   * logging as the same station letter). Session-only; Mission > Operational period shows a warning.
   * Nothing is renumbered.
   */
  public readonly lastMergeClashes = signal<Array<{ msgNo: string, uids: [string, string] }>>([])

  private storageLocalName = 'radioLog'
  private serverUri = 'https://localhost:4000/products' // FUTURE:
  private boundsMargin = 0.0025

  // https://angular.io/guide/architecture-services#providing-services: singleton or multiple service instances?!
  // #81 (2026-09-27): these used to be constructed twice because Entry re-listed them in its own
  // `providers` (fixed 2026-08-19). The guard below now throws if that ever happens again.
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
      // See mission.service.ts's own constructor for why this is `throw new Error(...)`
      // and not `throwError(() => ...)` - the rxjs creation function only builds an
      // observable; nothing subscribed to it here, so the guard never actually fired.
      const msg = `RadioLogService has already been provided. It is providedIn:'root' - do not list it in a component's providers.`
      this.log.error(msg, this.id)
      throw new Error(msg)
    }

    this.log.verbose("======== Constructor() ============", this.id)

    // Subscribe to Settings BEFORE loading reports: MissionService replays its current
    // value synchronously, so this populates this.settings first - initEmptyRadioLog()
    // stamps the new log with the current app version from it.
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.verbose('Settings Subscription complete', this.id)
    })

    this.radioLog = this.loadRadioLogFromLocalStorage()

    this.log.verbose(`Got v.${this.radioLog.version} dated ${this.radioLog.date} with ${this.radioLog.numReport} Radio Log entries from localstorage`, this.id)

    // bounds is a plain, synchronous BoundsType (radio-log-entry.interface.ts) - no async
    // involved. Likely extraneous most of the time (every mutation path already recalculates
    // before saving), but cheap enough to keep as a defensive safety net on load.
    this.recalcRadioLogBounds(this.radioLog)
    this.radioLogSignal = signal(this.radioLog)
    this.updateRadioLogAndPublish()
  }


  // 2026-09-27: checkRadioLogVersion() removed. It compared the app RELEASE string stamped on
  // the stored log with the running release - a mismatch after every deploy, so it could only
  // ever log a false error (and, wired to the settings subscription, did so on a mid-session
  // settings change). The real data version is `schemaVersion`, migrated on every load by
  // migrateRadioLog() (radio-log-migration.ts, ADR D-42).

  /**
   * Load any existing radio log from browser's Local Storage
   * FUTURE: If RadioLogType elements/structure changes in a future version, upgrade to that
   * @returns
   */
  private loadRadioLogFromLocalStorage(): RadioLogType {
    // E-122 Phase 2a: through RecordStore now, not localStorage directly - radio log entries can
    // carry missing-person PII (ARCHITECTURE.md "Encryption: exports today, storage later").
    // Synchronous to this caller, same as localStorage.getItem() was.
    let localStorageFieldReports = recordStore.getItem(this.storageLocalName)

    if (localStorageFieldReports == null) {
      this.log.verbose(`No Radio Log entries found in Local Storage. Will rebuild from defaults.`, this.id)
      return this.initEmptyRadioLog()
    }
    else if (localStorageFieldReports.indexOf("version") <= 0) {
      this.log.error(`Radio Log entries in Local Storage appear corrupted (no version #) & will be stored in Local Storage with key: '${this.storageLocalName}-BAD'. Will rebuild from defaults.`, this.id)
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
      return migrateRadioLog(JSON.parse(localStorageFieldReports), { ...this.msgNoContext(), number: !this.fieldMode.enabled() }) ?? this.initEmptyRadioLog()
    }
  }

  /** E-220: this device's mission, op period and station letter, as they are right now. */
  private msgNoContext(): MsgNoContext {
    return {
      mission: this.settings?.mission ?? '',
      opPeriod: this.settings?.opPeriod ?? '',
      station: this.devicePrefs.getMsgStation(),
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
    // Not the entry itself: it can name people and addresses, and the Log page exports to CSV.
    this.log.verbose(`Got new radio log entry.`, this.id)

    // EntryComponent hands this over as JSON.stringify(mergedFormValue()) - a deliberate
    // deep clone - so `date` arrives here as an ISO STRING even though RadioLogEntryType
    // declares it Date, and even though nothing has touched localStorage yet. Restoring it
    // at this boundary is what makes a locally-typed report indistinguishable from a
    // loaded one; without it, two reports typed in a single fresh session were enough to
    // make buildIcs309Log() throw. See json-dates.ts.
    let newReport: RadioLogEntryType = rehydrateDateFields(
      JSON.parse(formData) as RadioLogEntryType, //"[object Object]" is not valid JSON
      [...RADIO_LOG_ENTRY_DATE_FIELDS])
    newReport.id = this.radioLog.maxId++
    // D-59: permanent identity, so a hand-over can match this entry on another device.
    newReport.uid = newUid()
    // 2026-10-02, John (E-07 replay groundwork): when the entry was actually typed in, stamped
    // here and never edited. `date` is when the traffic happened, which the scribe may set back;
    // the gap between the two is what lets a replay flag an entry that was logged late.
    newReport.loggedAt = new Date()
    // E-220 / D-68: the message number, stamped once and never changed (a number the caller already
    // supplied is kept). The high-water mark makes sure a deleted entry's number is not handed out again.
    // A field phone stamps nothing (scoping 2): it is not a station on the log, and the scribe's device
    // numbers its entries when the Report Packet merges in. That keeps phones out of the letter question.
    if (!newReport.msgNo && !this.fieldMode.enabled()) {
      newReport.msgNo = nextMsgNo(this.radioLog.logEntries, this.radioLog.msgNoHighWater, this.msgNoContext())
      this.radioLog.msgNoHighWater = bumpHighWater(this.radioLog.msgNoHighWater, newReport.msgNo)
    }
    this.radioLog.numReport++
    this.radioLog.logEntries.push(newReport)

    // Recalculate rather than widen the existing box (this used to call Leaflet's
    // LatLngBounds.extend()). Two update paths that disagreed - extend() applied no
    // broadening margin - was D-22; one path means one answer, and the array is small
    // enough that a full pass costs nothing.
    this.recalcRadioLogBounds(this.radioLog)

    this.updateRadioLogAndPublish() // put to localStorage & update subscribers
    this.reportSubmittedSignal.update(n => n + 1)
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
  ): { added: number, skipped: number, rejected: number, updated?: number, clashes?: Array<{ msgNo: string, uids: [string, string] }> } {
    const resolvedCredentialId = normalizeRangerId(reporterCredential)
    const resolvedUid = resolvedCredentialId
      ? this.rangerService.rangers.find(r => normalizeRangerId(r.id) === resolvedCredentialId)?.uid
      : undefined

    const result = this.applyEntryMerge(incoming, { reporterCredential: resolvedCredentialId, resolvedUid })
    const { added, rejected } = result
    // Legacy Report Packet shape: "skipped" is every entry already present and left as it was.
    // `updated` (a later-revised copy of an entry this device holds, D-59) appears only when
    // there was one, so a packet with no revisions returns exactly what it always did.
    return {
      added, skipped: result.unchanged, rejected,
      ...(result.clashes.length ? { clashes: result.clashes } : {}),
      ...(result.updated ? { updated: result.updated } : {}),
    }
  }

  /**
   * Hand-over merge (D-59): merges entries with the people merge's uid remap and writes the
   * result. Unlike the Report Packet path it passes no reporter credential (the operator of a
   * hand-over file is the scribe, D-44). The full counts and named notes come back so the
   * caller can show a summary.
   */
  public mergeHandoverEntries(
    incoming: readonly RadioLogEntryType[],
    uidRemap: Record<string, string>,
  ): EntryMergeResult {
    return this.applyEntryMerge(incoming, { uidRemap })
  }

  /** Pure preview of the same merge: what would change, without touching the log. */
  public previewHandoverEntries(
    incoming: readonly RadioLogEntryType[],
    uidRemap: Record<string, string>,
  ): EntryMergeResult {
    return mergeEntries(this.radioLog.logEntries, incoming, {
      nextId: this.radioLog.maxId, uidRemap, msgNo: this.msgNoContext(), msgNoHighWater: this.radioLog.msgNoHighWater,
    })
  }

  private applyEntryMerge(
    incoming: readonly RadioLogEntryType[],
    opts: Omit<EntryMergeOptions, 'nextId'>,
  ): EntryMergeResult {
    const result = mergeEntries(this.radioLog.logEntries, incoming, {
      ...opts, nextId: this.radioLog.maxId, msgNo: this.msgNoContext(), msgNoHighWater: this.radioLog.msgNoHighWater,
    })
    this.lastMergeClashes.set(result.clashes)

    for (const note of result.rejectedNotes) {
      this.log.warn(`Rejected incoming entry ${note.id} (${note.reason}).`, this.id)
    }

    if (result.added || result.updated) {
      this.radioLog.logEntries = result.entries
      this.radioLog.maxId = result.nextId
      if (result.msgNoHighWater) this.radioLog.msgNoHighWater = result.msgNoHighWater
      this.radioLog.numReport = this.radioLog.logEntries.length
      this.recalcRadioLogBounds(this.radioLog)
      this.updateRadioLogAndPublish()
    }

    this.journal.record('reports-merged', `Merged radio log entries: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.rejected} rejected.`)
    return result
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
  public buildReportPacketText(operator: string): { text: string; filename: string; count: number; uids: string[] } | null {
    const entries = this.getCurrentRadioLog().logEntries
    if (!entries.length) {
      return null
    }

    // Same JSON.parse(JSON.stringify(...)) workaround backup.service.ts/mission-zip.ts
    // already use for "Should not import the named export ... from default-exporting module."
    const appVersion = JSON.parse(JSON.stringify(packageJson)).version

    // 2026-10-28, John: a field phone has no mission of its own (its header shows none), so its
    // packet names none. The command post skips the name check when it is blank and checks the
    // reports' times instead (packet-time-check.ts).
    const packet = buildReportPacket({
      entries,
      settings: this.fieldMode.enabled() ? { mission: '', event: '', opPeriod: '' } : this.settings,
      operator,
      appVersion,
    })
    return {
      text: JSON.stringify(packet, null, 2),
      filename: reportPacketFilename(packet.mission, packet.exportedAt),
      count: entries.length,
      uids: entries.map(e => e.uid).filter((u): u is string => !!u),
    }
  }

  /**
   * D-60 item 6: the originals this device holds for the live attachments on its entries, as
   * files named uniquely, to go beside the Report Packet's `.txt`. References whose bytes are on
   * another device are simply not here.
   */
  public async reportPacketMedia(): Promise<File[]> {
    const refs = distinctLiveRefs(this.getCurrentRadioLog().logEntries)
    const names = shareNames(refs)
    const out: File[] = []
    for (const ref of refs) {
      if (!(await this.attachmentStore.has(ref.sha256))) continue
      const blob = await this.attachmentStore.getOriginal(ref.sha256)
      out.push(new File([blob], names.get(ref.sha256) ?? ref.name, { type: ref.type || blob.type }))
    }
    return out
  }

  /**
   * D-60 item 6: files that arrived with (or after) a Report Packet. Each is hashed, and stored
   * through `putVerified` only when a live reference on this device names that fingerprint - so
   * run this AFTER the packet's entries are merged in. `packetEntries` are the entries of the
   * packet loaded with them, if any: their live references with no bytes here are the ones
   * "still on the ranger's phone". Counts only; nothing about the files is logged.
   */
  public async storePacketMedia(
    files: readonly File[], packetEntries?: readonly RadioLogEntryType[],
  ): Promise<{ added: number, unmatched: number, remote: number }> {
    const live = new Set(distinctLiveRefs(this.getCurrentRadioLog().logEntries).map(r => r.sha256))
    const hashed: { name: string, sha256: string, file: File }[] = []
    for (const file of files) hashed.push({ name: file.name, sha256: await sha256Hex(await file.arrayBuffer()), file })
    const { matched, unmatched } = matchMedia(hashed, live)
    let added = 0
    for (const m of matched) {
      if (await this.attachmentStore.has(m.sha256)) continue
      const file = hashed.find(h => h.sha256 === m.sha256)!.file
      await this.attachmentStore.putVerified(m.sha256, await file.arrayBuffer(), file.type)
      added++
    }
    let remote = 0
    if (packetEntries) {
      const held = new Set<string>()
      const refs = distinctLiveRefs(packetEntries)
      for (const r of refs) if (await this.attachmentStore.has(r.sha256)) held.add(r.sha256)
      remote = stillRemote(refs, held)
    }
    this.log.info(`Report Packet files: ${added} stored, ${unmatched.length} unmatched, ${remote} still elsewhere.`, this.id)   // part of the merge the journal already records
    return { added, unmatched: unmatched.length, remote }
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

  /**
   * E-218: moves an entry's status mark one step round blank, handled, passed on, needs action, blank,
   * stamps when, and saves. Works on the entry in place (the grid and the Messages page hold the
   * service's own objects). Not journalled (D-67): a mark is changed often and is not a record.
   * An entry passed that is not in the log (a copy) is changed and saved all the same.
   */
  public cycleHandledMark(entry: RadioLogEntryType): void {
    const mark = nextHandledMark(entry.handled?.mark)
    if (mark) entry.handled = { mark, at: new Date() }
    else {
      delete entry.handled
      entry.handledClearedAt = new Date()
    }
    this.saveEditedRadioLog()
  }

  /**
   * E-194 / D-60: adds attachment references to a saved entry, or marks some removed. The union
   * by fingerprint (sticky removal) is the same rule a merge uses, so an add can never drop a
   * reference. `stampRevised` for an add or removal on an existing entry (D-47): `revisedAt`
   * is what lets the change travel in a hand-over. A new entry's own first attachments do not
   * stamp it. Returns the entry, or undefined when no entry has this uid.
   */
  public mergeEntryAttachments(uid: string, refs: readonly AttachmentRef[], stampRevised: boolean): RadioLogEntryType | undefined {
    const entry = this.radioLog.logEntries.find(e => e.uid === uid)
    if (!entry) return undefined
    entry.attachments = mergeAttachmentRefs(entry.attachments, refs)
    if (stampRevised) entry.revisedAt = new Date()
    this.saveEditedRadioLog()
    return entry
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
      this.log.verbose(`No rows are selected yet, so the selected radio log is empty.`, this.id)
      this.selectedRadioLog = this.initEmptyRadioLog()
      this.selectedRadioLog.filter = "As selected by user"
      this.selectedRadioLog.logEntries = []
      this.selectedRadioLog.numReport = 0
    }
    return this.selectedRadioLog
  }

  public async deleteAllRadioLogEntries(): Promise<void> {
    // TODO: reset header properties too?!
    this.radioLog.logEntries = []
    recordStore.removeItem(this.storageLocalName)
    // E-114 (2026-08-31): maxId is deliberately NOT reset any more (was `= 0` here, flagged
    // with its own "is this desired???"). Resetting let a brand-new, unrelated report reuse
    // an old display number after a clear-all - confusing on its own, worse once a printed/
    // cited 213 could reference "entry 3" meaning two different reports at different times.
    // Left monotonic per device instead - decided in the roadmap's E-114 write-up.

    // E-194 / D-60 item 8: no entry names any attachment now, so none of their bytes stay.
    await this.attachmentStore.sweepOrphans([])
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
    this.log.verbose(`recalcRadioLogBounds got ${reports.logEntries.length} radio log entries`, this.id)

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
      // no radio log entries yet! Rely on broadening processing below
      north = this.settings.defLat
      west = this.settings.defLng
      south = this.settings.defLat
      east = this.settings.defLng
    }

    // Broaden boundaries to minimum values
    this.log.verbose(`recalcRadioLogBounds got E:${east} W:${west} N:${north} S:${south} `, this.id)
    if (east - west < 2 * this.boundsMargin) {
      east += this.boundsMargin
      west -= this.boundsMargin
      this.log.verbose(`recalcRadioLogBounds BROADENED to E:${east} W:${west} `, this.id)
    }
    if (north - south < 2 * this.boundsMargin) {
      north += this.boundsMargin
      south -= this.boundsMargin
      this.log.verbose(`recalcRadioLogBounds BROADENED to N:${north} S:${south} `, this.id)
    }

    reports.bounds = { north, south, east, west }
    this.log.excessive(`New bounds: E: ${east};  N: ${north};  W: ${west};  S: ${south};  `, this.id)
  }

}
