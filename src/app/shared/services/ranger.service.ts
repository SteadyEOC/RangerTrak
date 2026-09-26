import { Observable, Observer, of, ReplaySubject, throwError } from 'rxjs'

import { formatDate } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { Injectable, OnInit, Optional, signal, SkipSelf } from '@angular/core'

//import { debounceTime, map, startWith } from 'rxjs/operators'
import { LogService, RangerType, UnknownRanger } from './'
// ADR D-42/D-43: identity + versioned storage for the roster. Kept as a direct import (not
// via the barrel) to avoid a cycle - the barrel re-exports this service.
import { migrateRangers, normalizeRangerIds, RANGER_SCHEMA_VERSION } from './ranger-migration'
// E-122 Phase 2a: the roster is PII, and now lives behind RecordStore (in-memory + IndexedDB)
// rather than directly in localStorage. Direct import (not the barrel), same reasoning as the
// migration import above.
import { recordStore } from '../storage/record-store'

// TODO: Update server with new/deleted Rangers:  https://angular.io/tutorial/toh-pt6#heroes-and-http


@Injectable({ providedIn: 'root' })
export class RangerService implements OnInit {
  observeRangers$: Observable<RangerType[]> | null = null

  id = 'Ranger Service'

  // rangersSignal is the single source of truth for state. rangersReplay$ is
  // a thin, synchronously-fed notification layer for existing Observable
  // consumers - see the equivalent, more-detailed comment in
  // mission.service.ts for why (toObservable()'s effect-based bridge is
  // asynchronous; several consumers need synchronous emission).
  private rangersSignal = signal<RangerType[]>([])
  private rangersReplay$ = new ReplaySubject<RangerType[]>(1)
  // `rangers` is mutated in place throughout this class (push/splice/sort)
  // rather than reassigned; updateLocalStorageAndPublish() is the single
  // point that syncs that mutable array's current contents out to
  // rangersSignal/rangersReplay$ and localStorage.
  rangers: RangerType[] = []

  private localStorageRangerName = 'rangers'
  excelData: any[][] = [[1, 2], [3, 4]]


  // https://angular.io/guide/architecture-services#providing-services: singleton or multiple service instances?!
  //! REVIEW: Field & Ranger Services BOTH call constructors twice!!
  constructor(
    @Optional() @SkipSelf() existingService: RangerService,
    private httpClient: HttpClient,
    private log: LogService
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
    // REVIEW: this.log.verbose(`Constructor call stack: ${new Error().stack}`, this.id)

    this.LoadRangersFromLocalStorage()
    this.log.verbose(`Got ${this.rangers.length} from Local Storage`, this.id)

    // Maintainer, 2026-08-26: a fresh install used to auto-seed the 18 hardcoded Vashon
    // station callsigns here, unconditionally, for every new user everywhere - "Rangers
    // should start blank. That should indicate a new mission!" A blank roster is now itself
    // the first-run signal (see isRealRosterLoaded() below, simplified now that there's no
    // untouched-default state to distinguish from "real").
    //
    // Removed 2026-08-31: the Rangers page's own "Add station callsigns" Danger-zone button
    // that offered these 18 as an opt-in starter set - it only ever appended (never deduped),
    // so a second press or a press on top of a real roster produced duplicate callsigns, and
    // it offered nothing "Load sample data" (SampleDataService) doesn't already do better: a
    // full, replace-not-append demo roster with real field reports. loadHardcodedRangers()
    // itself stays - ranger.service.spec.ts uses it as a quick way to seed a test roster.
    if (this.rangers.length === 0) {
      this.log.verbose(`First run on this browser (or roster was emptied): starting blank. Load a real roster via Import roster or Restore mission.`, this.id)
    }

    this.updateLocalStorageAndPublish()
  }

  ngOnInit() {
    this.updateLocalStorageAndPublish()
  }

  /**
   * Expose Observable to 3rd parties, but not the actual subject (which could be abused)
   */
  public getRangersObserver(): Observable<RangerType[]> {
    return this.rangersReplay$.asObservable()
  }

  /**
   * D-32 readiness signal: true once the roster actually has someone in it.
   *
   * Simplified 2026-08-26: this used to compare against the exact 18 hardcoded station
   * callsigns, because a fresh install auto-seeded those on first run and a plain
   * `length > 0` check couldn't tell "prepared" from "untouched default". Now that a blank
   * roster IS the first-run state - nothing seeds it anymore, "Rangers should start blank,
   * that should indicate a new mission" - there's no untouched-default state left to
   * distinguish from real. Any ranger present, including via the opt-in "Add station
   * callsigns" button, counts as ready; zero rangers means the roster genuinely hasn't been
   * set up yet.
   */
  public static isRealRosterLoaded(rangers: RangerType[]): boolean {
    return rangers.length > 0
  }

  /**
    * Update localStorage with new rangers & notify observers
    * REVIEW: ALSO called from RangerComponent with new updates!
    *
    * TODO: Should new rangers be a parameter/argum,ent?!
    */
  public updateLocalStorageAndPublish() {
    // Do any needed sanity/validation here

    this.log.verbose(`New set of ${this.rangers.length} rangers. Save to local storage & publish`, this.id)
    this.SortRangersByCallsign()   // Only place this needs to be called?

    //! TODO: encrypt user data (in LocalStorage or elsewhere)
    // https://github.com/brix/crypto-js - requires Node.js

    // ADR D-42/D-43 Phase 2: stored as a VERSIONED WRAPPER now, not a bare array, so a
    // future schema change has a seam to hook into. migrateRangers() still reads the old bare
    // form, so this transition is one-way and silent.
    //
    // E-122 Phase 2a: through RecordStore now, not localStorage.setItem() directly - the
    // roster is PII (ARCHITECTURE.md "Encryption: exports today, storage later"). RecordStore
    // is synchronous to this caller (an in-memory Map backs getItem/setItem), so nothing else
    // in this method needs to change.
    recordStore.setItem(this.localStorageRangerName,
      JSON.stringify({ schemaVersion: RANGER_SCHEMA_VERSION, rangers: this.rangers }))

    // Signal gets a fresh array copy: this.rangers is mutated in place
    // (push/splice/sort), so passing the same reference to .set() would be
    // treated as "no change" by the signal's default equality check and
    // silently skip notifying signal-based consumers. The Replay layer gets
    // the original live reference, matching the exact prior BehaviorSubject
    // behavior for existing Observable-based consumers.
    this.rangersSignal.set([...this.rangers])
    this.rangersReplay$.next(this.rangers)
  }

  //--------------------------------------------------------------------------
  // 2026-08-26: dropped the `storedRosterWasReadable` bookkeeping flag this method used to
  // maintain - its only consumer was the constructor's auto-seed guard (removed the same
  // day, see the constructor's own comment), which needed to tell "nothing stored yet" apart
  // from "stored, but corrupt" apart from "deliberately emptied". Now that a blank roster is
  // never auto-replaced with anything, all three of those cases correctly land on the same
  // `this.rangers = []` outcome below - there's no longer a decision that depends on which
  // one it was.
  LoadRangersFromLocalStorage() { // WARN: Replaces any existing Rangers
    // E-122 Phase 2a: reads through RecordStore now (see updateLocalStorageAndPublish()'s own
    // comment) - synchronous, same as localStorage.getItem() was, so nothing below changes.
    let localStorageRangers = recordStore.getItem(this.localStorageRangerName)
    try {
      // ADR D-42/D-43, Phase 2: everything stored goes through migrateRangers(), which
      // accepts BOTH the versioned `{schemaVersion, rangers}` wrapper and the bare array this
      // app wrote before 2026-08-26, guarantees every ranger an internal `uid` (the join
      // key), and canonicalizes any credential into `id`. Called unconditionally rather than
      // behind a version check at this call site - the gate lives inside the function, where
      // it can be reasoned about. See [[settings-schema-version-discipline]] for why the
      // other arrangement was itself the bug, twice.
      const parsed = (localStorageRangers != null) ? JSON.parse(localStorageRangers) : null
      const store = migrateRangers(parsed)
      this.rangers = store.rangers
      this.log.excessive(`Loaded ${this.rangers.length} rangers from local storage (schema v${store.schemaVersion})`, this.id)
    } catch (error: any) {
      this.rangers = []
      this.log.verbose(`Unable to parse Rangers from Local Storage. Error: ${error.message}`, this.id)
    }
    this.SortRangersByCallsign()   // TODO: Getting called too often?
  }

  //--------------------------------------------------------------------------

  // Or see code part way thru: https://www.geeksforgeeks.org/how-to-display-loading-screen-when-navigating-between-routes-using-angular/
  // for batsman.component.ts

  // REMOVED: LoadRangersFromJSON() and the `import * as rangers from
  // '../../../assets/data/Rangers.3Feb22.json'` it relied on.
  //
  // That file no longer exists under src/ at all: it was moved out of the repo tree on
  // 2026-08-31 to `rangertrak-InternalDocs/roster-build/Rangers.3Feb22.json` (verified
  // byte-identical first), the same posture .gitignore's own note already applies to
  // InternalDocs - real operator data is kept out of the working tree rather than relying
  // on an ignore rule. It had been gitignored (.gitignore: /src/assets/data/ranger*.json),
  // but only matched because Windows sets core.ignorecase=true - the pattern is lowercase
  // `ranger*` and the file was `Rangers.3Feb22.json`, so on a case-sensitive filesystem it
  // would not have been ignored at all.
  //
  // It holds a real roster - 286 people with names, phone numbers and street addresses. A static
  // import meant the bundler inlined all of it into the shipped JavaScript, so every
  // deployed build published that roster to anyone who loaded the site. It also made the
  // project unbuildable from a clean clone, which is why CI could not typecheck: the same
  // defect as the secrets.json import (PRIVATE-Roadmap.md Section 9e).
  //
  // Nothing called the method - its only caller was the Rangers page's JSON import
  // button, removed with the other non-working import experiments. A fresh install starts
  // blank; a real roster arrives via Import roster or Restore mission.

  //--------------------------------------------------------------------------
  // REMOVED (2026-08-31, log-noise audit): LoadRangersFromExcel(). Same shape as the
  // LoadRangersFromJSON() removal documented just above - nothing called it, its only
  // callers (the Rangers page's two Excel-import buttons) were removed with the other
  // non-working import experiments, and a real roster arrives via Import roster/Restore
  // mission instead. What remained was five numbered `log.excessive("N Got...")` trace
  // lines left over from once debugging it live, on a method nothing could reach anymore.

  /**
   * Empties the roster and *records* that it is deliberately empty.
   *
   * This used to `localStorage.removeItem()`, which made "Delete Rangers" impossible to
   * actually complete: the page reloads, the constructor finds no stored roster, decides
   * this must be a first run, and seeds the 18 hardcoded stations straight back. The old
   * UI text admitted it - "they will immediately get replaced with the hardcoded names!"
   * - but it meant anyone clearing the roster to load their own fought the app.
   *
   * Writing an empty array instead keeps the key present, which is how the constructor
   * now tells "never used this app" from "emptied it on purpose".
   */
  deleteAllRangers() {
    this.rangers = []
    this.updateLocalStorageAndPublish()
    this.log.warn(`Emptied the roster (stored as an empty list, so it stays empty).`, this.id)
  }

  /** Replaces the whole roster wholesale (e.g. restoring from a mission backup). */
  replaceAllRangers(newRangers: RangerType[]) {
    this.rangers = [...newRangers]
    this.updateLocalStorageAndPublish()
  }

  /**
   * Parses a roster from JSON text, for "Import roster" on the Rangers page.
   *
   * Deliberately liberal about the wrapper, because the file a team actually has in hand
   * could reasonably be any of these:
   *   - a bare array:            [ {callsign: ...}, ... ]
   *   - a mission export:        { schemaVersion, settings, rangers: [...], ... }
   *   - a hand-made wrapper:     { rangers: [...] }
   * Importing a roster should not require knowing which of those someone produced.
   *
   * Strict about the contents, though: every entry needs SOME resolvable identity - a
   * callsign, or an `id`/`rew` credential normalizeRangerIds() can canonicalize. D-42: a
   * callsign alone is no longer required, since plenty of CERT/MERT responders are not
   * ham-licensed - but a row with none of the three is a name with nothing to attribute a
   * field report to, worse than no row at all.
   *
   * Missing optional fields are filled with empty strings rather than left undefined, so
   * the grid and the CSV export do not render "undefined" to an operator.
   *
   * Throws with a message meant to be shown to a user, not logged.
   */
  parseRosterJson(text: string): RangerType[] {
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch (error: any) {
      throw new Error(`That file is not valid JSON (${error.message}).`)
    }

    const raw =
      Array.isArray(parsed) ? parsed :
        Array.isArray(parsed?.rangers) ? parsed.rangers :
          null

    if (raw === null) {
      throw new Error(
        'That file does not contain a roster. Expected either a list of rangers, or a mission export with a "rangers" list.')
    }

    if (raw.length === 0) {
      throw new Error('That file contains an empty roster - nothing to import.')
    }

    const rangers: RangerType[] = raw.map((entry: any, i: number) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Entry ${i + 1} is not a ranger record.`)
      }
      const callsign = String(entry.callsign ?? '').trim()
      // D-42 phase 8: `rew` is retired as a stored field, but a real roster in hand may
      // still use that name - fold it into `id` right here rather than carrying it any
      // further. An explicit `id` wins if the file somehow has both.
      const id = String(entry.id ?? entry.rew ?? '').trim()
      if (!callsign && !id) {
        throw new Error(
          `Entry ${i + 1} has no callsign and no id/rew - there is nothing to attribute a field report to.`)
      }
      return {
        callsign,
        id,
        // Field-name aliases. Real rosters in hand do not use this app's field names: an
        // FCC-derived export calls the person "licensee", and carries "icon"/"status"
        // where RangerType has "image"/"role". Accepting the aliases is the difference
        // between a roster importing and importing with every Full Name blank.
        fullName: String(entry.fullName ?? entry.licensee ?? entry.name ?? ''),
        phone: String(entry.phone ?? ''),
        image: String(entry.image ?? entry.icon ?? ''),
        team: String(entry.team ?? ''),
        role: String(entry.role ?? entry.status ?? ''),
        note: String(entry.note ?? entry.notes ?? ''),
      } as RangerType
    })

    // ADR D-42/D-43: normalize on the way in, so every import path (bare array, {rangers},
    // mission export, zip bundle) yields rangers with a uid and a canonical id. Credentials
    // are never invented here - a roster entry with none stays blank and is reported by
    // rosterWarnings() below.
    return normalizeRangerIds(rangers).rangers
  }

  /**
   * Non-fatal problems worth showing someone before they commit to an import.
   *
   * Duplicate callsigns are the interesting case. Callsign is the key every field report
   * joins on, so duplicates are genuinely ambiguous - but refusing a 286-entry roster over
   * one repeated row is the wrong trade when a team is trying to get set up. Report it and
   * let them decide.
   */
  rosterWarnings(rangers: RangerType[]): string[] {
    const warnings: string[] = []

    // Raised live 2026-08-26, alongside the same flag added to the map marker (a blank
    // callsign there falls back to a fixed "unassigned" icon, ranger-icon.ts) and the
    // Rangers grid (rangers.component.ts). Checked BEFORE the duplicate check below and
    // excluded from it: multiple blank callsigns would otherwise also trip that check
    // (they're all the same empty string), reading as a confusing "1 duplicate callsign: "
    // with nothing printed after the colon, instead of the real, clearer story.
    //
    // D-42 phase 7: this used to also tell the operator to "give each one any short unique
    // identifier" - that advice is now the `id` field itself, so it is reported separately
    // below rather than repeated here as a workaround.
    const blank = rangers.filter(r => !r.callsign.trim()).length
    if (blank) {
      warnings.push(
        `${blank} of ${rangers.length} entries have no callsign - expected for volunteers `
        + `who are not ham-licensed.`)
    }

    const signs = rangers.filter(r => r.callsign.trim()).map(r => r.callsign.toUpperCase())
    const duplicateCallsigns = [...new Set(signs.filter((c, i) => signs.indexOf(c) !== i))]
    if (duplicateCallsigns.length) {
      warnings.push(
        `${duplicateCallsigns.length} duplicate callsign${duplicateCallsigns.length > 1 ? 's' : ''}: `
        + `${duplicateCallsigns.slice(0, 5).join(', ')}${duplicateCallsigns.length > 5 ? '...' : ''}. `
        + `Field reports filed against these cannot tell the rows apart.`)
    }

    // D-42: `id` is the displayed, searchable credential (REW-####/TEW-####, or a regional
    // equivalent like VI-0038). A blank one is expected - "hasn't checked in yet" - not a
    // defect. A duplicate one is real and ambiguous, and this app never auto-merges or
    // rewrites it (see normalizeRangerIds()), so it must be surfaced loudly here too.
    const blankIds = rangers.filter(r => !r.id?.trim()).length
    if (blankIds) {
      warnings.push(
        `${blankIds} of ${rangers.length} entries have no id - not checked in yet, or no `
        + `credential on file.`)
    }

    const ids = rangers.filter(r => r.id?.trim()).map(r => r.id!.toUpperCase())
    const duplicateIds = [...new Set(ids.filter((c, i) => ids.indexOf(c) !== i))]
    if (duplicateIds.length) {
      warnings.push(
        `${duplicateIds.length} duplicate id${duplicateIds.length > 1 ? 's' : ''}: `
        + `${duplicateIds.slice(0, 5).join(', ')}${duplicateIds.length > 5 ? '...' : ''}. `
        + `Field reports filed against these cannot be told apart.`)
    }

    const nameless = rangers.filter(r => !r.fullName.trim()).length
    if (nameless) {
      warnings.push(`${nameless} of ${rangers.length} entries have no name - only a callsign.`)
    }

    return warnings
  }

  // this needs be done for the autocomplete control in the enter comonent to work correctly
  // TODO: Getting called too often?
  SortRangersByCallsign() {
    this.log.excessive(`SortRangersByCallsign: ${this.rangers.length} Rangers in array`, this.id)

    return this.rangers.sort((n1, n2) => {
      if (n1.callsign > n2.callsign) { return 1 }
      if (n1.callsign < n2.callsign) { return -1 }
      return 0;
    })
  }

  // TODO: verify new report is proper shape/validated here or by caller??? Send as string or object?
  public AddRanger(formData: string = ""): RangerType {
    this.log.excessive(`Got new ranger: ${formData}`, this.id)
    let newRanger: RangerType
    if (formData != "") {
      newRanger = JSON.parse(formData)
    } else {
      newRanger = {
        // D-42: no id here - the app never mints a credential, only an operator or the
        // incident's own check-in process supplies one.
        callsign: "!A_New_Tactical", fullName: "AAA_New_Name",
        image: "male.png", phone: "206-463-0000", team: "", role: "", note: `Manually added at ${formatDate(Date.now(), 'short', "en-US")}.` //https://angular.io/guide/i18n-common-locale-id
      }
    }
    // ADR D-43: mint the surrogate key at creation rather than relying on the next load's
    // migration - a report could be filed against this ranger before then.
    //
    // Normalized against the WHOLE roster, not in isolation: uid uniqueness is only
    // meaningful relative to the rangers that already exist. `rangers` is mutated in place
    // throughout this class, so the result is spliced back rather than reassigned.
    this.rangers.push(newRanger)
    const normalized = normalizeRangerIds(this.rangers).rangers
    this.rangers.splice(0, this.rangers.length, ...normalized)
    newRanger = this.rangers[this.rangers.length - 1]

    this.updateLocalStorageAndPublish();
    return newRanger;
  }


  public async loadRangersFromExcel2() {  // still called by rangers Component from a button
    //debugger
    // Loaded on demand: RangerService is providedIn:'root' and injected by the Entry page,
    // so it lands in the eager initial bundle - a static import here would pull csvImport's
    // own xlsx dependency (~800KB) into every user's initial download for one button on the
    // Rangers page most users never press.
    const { csvImport } = await import('../../rangers/csvImport')
    let fnc = new csvImport(document)
    fnc.importExcel2()
    //csvImport.importExcel2()
    this.log.verbose(`Got excel file`, this.id)
  }

  /**
   * Look up by CALLSIGN - what a scribe hears on the radio and types into Entry.
   *
   * ADR D-43: renamed from `getRanger()` deliberately. A ranger has three identifiers (`uid`
   * joins, `id` is the credential, `callsign` is radio terminology), so an unqualified
   * "getRanger" no longer says enough - code reaching for the wrong one is the exact class of
   * bug this migration exists to prevent. Every lookup now names its key.
   *
   * Callsigns are neither unique nor required (plenty of CERT/MERT responders are not
   * ham-licensed), so this returns the FIRST match. Use `getRangerByUid()` anywhere identity
   * actually matters.
   */
  getRangerByCallsign(callsign: string) {
    const index = this.findIndexByCallsign(callsign);
    if (index >= 0) {
      return this.rangers[index]
    }
    this.log.error(`getRangerByCallsign got unknown callsign: ${callsign}`, this.id)
    return UnknownRanger
  }

  /**
   * Look up by the internal surrogate key - the ranger/report join key (ADR D-43). The one to
   * use whenever identity matters: it is the only identifier guaranteed present and unique.
   */
  getRangerByUid(uid: string) {
    const index = this.findIndexByUid(uid);
    if (index >= 0) {
      return this.rangers[index]
    }
    this.log.error(`getRangerByUid got unknown uid: ${uid}`, this.id)
    return UnknownRanger
  }

  /**
   * ADR D-43: matches on `uid`, not callsign. Keying an update on callsign meant editing a
   * ranger's callsign could never be saved - the lookup searched for the NEW value and found
   * nothing - and two rangers sharing a blank callsign would overwrite each other.
   */
  updateRanger(ranger: RangerType) {
    const uid = String(ranger.uid ?? '').trim()
    if (!uid) {
      this.log.error(`updateRanger got a ranger with no uid (callsign: ${ranger.callsign})`, this.id)
      return
    }
    const index = this.findIndexByUid(uid);
    if (index >= 0) {
      this.rangers[index] = ranger;
      this.updateLocalStorageAndPublish();
    } else {
      this.log.error(`updateRanger got unknown uid: ${uid}`, this.id)
    }
  }

  /**
   * ADR D-43: deletes by the surrogate key, so a blank or duplicated callsign cannot take out
   * the wrong row.
   */
  deleteRangerByUid(uid: string) {
    const index = this.findIndexByUid(uid);
    if (index >= 0) {
      this.rangers.splice(index, 1);
      this.updateLocalStorageAndPublish();
    } else {
      this.log.error(`deleteRangerByUid got unknown uid: ${uid}`, this.id)
    }
  }

  private findIndexByUid(uid: string): number {
    for (let i = 0; i < this.rangers.length; i++) {
      if (this.rangers[i].uid === uid) return i;
    }
    return -1
  }

  /** First match only - callsigns are neither unique nor required. See getRangerByCallsign(). */
  private findIndexByCallsign(callsign: string): number {
    for (let i = 0; i < this.rangers.length; i++) {
      if (this.rangers[i].callsign === callsign) return i;
    }
    return -1
  }

  //--------------------------------------------------------------------------
  loadHardcodedRangers() {
    this.log.verbose("Adding all hardcoded Rangers", this.id)

    /* Following from 98070 AND 98013 zip codes, MUST be sorted by call sign!
        https://wireless2.fcc.gov/UlsApp/UlsSearch/searchAmateur.jsp
  */
    // REVIEW: push (i.e., add) vs. replace?
    this.rangers.push(

      // NOTE: The image names are case-sensitive!!
      // D-42 phase 8: no `rew`/`id` seeded here - these are station callsigns, not checked-in
      // credentials, and the app never mints one (see AddRanger()'s equivalent note above).
      { callsign: "!CmdPost", fullName: "ACS-CERT Cmd Post", phone: "206-463-", image: "CmdPost.jpg", team: "T0", role: "Licensed", note: "-" },

      { callsign: "ACS1", fullName: "ACS-CERT Team 1", phone: "206-463-", image: "ham_blue.png", team: "T1", role: "Licensed", note: "-" },
      { callsign: "ACS2", fullName: "ACS-CERT Team 2", phone: "206-463-", image: "ham_red.png", team: "T1", role: "Licensed", note: "-" },
      { callsign: "ACS3", fullName: "ACS-CERT Team 3", phone: "206-463-", image: "ham_yellow.png", team: "T1", role: "Licensed", note: "-" },
      { callsign: "ACS4", fullName: "ACS-CERT Team 4", phone: "206-463-", image: "team_brown.png", team: "T1", role: "Licensed", note: "-" },

      { callsign: "CERT1", fullName: "CERT 1", phone: "206-463-", image: "CERT_red.png", team: "CERT1", role: "Licensed", note: "-" },
      { callsign: "CERT2", fullName: "CERT 2", phone: "206-463-", image: "CERT_green.png", team: "CERT2", role: "Licensed", note: "-" },
      { callsign: "CERT3", fullName: "CERT 3", phone: "206-463-", image: "CERT_yellow.png", team: "CERT3", role: "Licensed", note: "-" },
      { callsign: "CERT4", fullName: "CERT 4", phone: "206-463-", image: "CERT_blue.png", team: "CERT4", role: "Licensed", note: "-" },
      { callsign: "CERT5", fullName: "CERT 5", phone: "206-463-", image: "CERT_brown.png", team: "CERT5", role: "Licensed", note: "-" },
      { callsign: "CERT6", fullName: "CERT 6", phone: "206-463-", image: "CERT_purple.png", team: "CERT6", role: "Licensed", note: "-" },

      { callsign: "MERT1", fullName: "MERT 1", phone: "206-463-", image: "MERT_red.png", team: "MERT1", role: "Licensed", note: "-" },
      { callsign: "MERT2", fullName: "MERT 2", phone: "206-463-", image: "MERT_green.png", team: "MERT2", role: "Licensed", note: "-" },
      { callsign: "MERT3", fullName: "MERT 3", phone: "206-463-", image: "MERT_yellow.png", team: "MERT3", role: "Licensed", note: "-" },
      { callsign: "MERT4", fullName: "MERT 4", phone: "206-463-", image: "MERT_blue.png", team: "MERT4", role: "Licensed", note: "-" },
      { callsign: "MERT5", fullName: "MERT 5", phone: "206-463-", image: "Yacht_purple.png", team: "MERT5", role: "Licensed", note: "-" },
      { callsign: "MERT6", fullName: "MERT 6", phone: "206-463-", image: "sail.png", team: "MERT6", role: "Licensed", note: "-" },

      { callsign: "Mobile", fullName: "Mobile Unit", phone: "206-463-", image: "Ranger.png", team: "MERT6", role: "Licensed", note: "-" },
    )


    // A second, commented-out roster of ~307 entries used to sit here: 267 distinct real
    // names and 197 street addresses for licensed amateurs in the 98070/98013 ZIPs, pulled
    // from the FCC ULS. It was dead code - already commented out, never executed - but it
    // was *tracked* source in a public repository, which is a worse place for neighbors'
    // home addresses than a gitignored data file (see PRIVATE-Roadmap.md Section 9f).
    //
    // Deleted 2026-08-14. The live seed above is stations only. Real rosters arrive via
    // Restore mission; the fictional demo roster lives in SampleDataService.
    //this.log.verbose(`Next: update LocalStorage: ${this.localStorageRangerName}`, this.id)
    this.SortRangersByCallsign()
    this.updateLocalStorageAndPublish();
    //this.log.verbose(`returned from: updating LocalStorage: ${this.localStorageRangerName}`, this.id)
  }

  // FUTURE:  getActiveRangers() {
  // filter for Ranger.status == 'checked in' ?
  // return this.rangers }
}



