import { LocationType } from './location.interface'

// 2026-08-31: renamed from field-report.interface.ts / FieldReportType / FieldReportsType /
// FieldReportStatusType / FieldReportSource / fieldReportArray, a naming holdover from before
// the page itself was renamed Reports -> Radio Log (0.75.0's ICS-309/213 restructuring) -
// "Radio Log entry" had become an inconsistent second name for the same thing the rest of the
// app calls a Radio Log entry. Includes the persisted-shape property name (`logEntries`,
// below) and the localStorage key (`radio-log.service.ts`'s `storageLocalName`) this time,
// not just type names - the app has no real users yet ([[no-real-users-yet-rename-freely]]),
// so there is no stored data or exported mission file anywhere to orphan.

// E-41 phase 1 (2026-08-26): was a dead, commented-out field (`// source: FieldReportSource`
// below) until the maintainer confirmed it directly - "Yes, we should include a field
// acknowledging source type." Every entry gathers this now, not just ones flagged for a 213.
//
// A string-literal union, not a numeric TS `enum` (this file's original commented-out sketch
// used one) - same idiom as this project's own StatusKey (status-color.ts), and a deliberate
// choice, not just a style preference: Signal Forms' native `[formField]` binding for a
// radio input compares the model value against `element.value` with `===`
// (`node_modules/@angular/forms/fesm2022/signals.mjs`'s `setNativeControlValue`), and every
// DOM attribute value is a string - a numeric model value could never strictly-equal a radio
// element's own string `value`, so the control would silently never show as checked. Confirmed
// by reading that file before choosing this, not guessed.
// F29-43 (2026-08-29): 'Phone' added - 'Voice' stays first (array order is UI order, and
// radio-over-voice is the hot-path common case).
export const RADIO_LOG_ENTRY_SOURCES = ['Voice', 'Phone', 'Packet', 'APRS', 'Email'] as const
export type RadioLogEntrySource = typeof RADIO_LOG_ENTRY_SOURCES[number]

/**
 * A plain, serializable bounding box.
 *
 * Deliberately NOT a Leaflet `LatLngBounds`: RadioLogType is round-tripped
 * through localStorage as JSON, and a class instance comes back as a bare object
 * with no methods, so every `.getEast()` on a reloaded value threw. Map engines
 * (Leaflet, MapLibre) each take their own bounds shape - convert at the point of
 * use, not in the stored model.
 */
export type BoundsType = {
  north: number,
  south: number,
  east: number,
  west: number
}

/**
 * A packet of all (or selected/filtered) field data for the op period except Rangers or Settings
 */
export type RadioLogType = {
  // Persisted-shape version, owned by radio-log-migration.ts
  // (RADIO_LOG_SCHEMA_VERSION). Distinct from `version` below, which is the APP version
  // string stamped for information and never compared.
  //
  // Optional during the migration and stamped by `migrateRadioLog()` on load - the same
  // additive approach RangerType.id uses, so nothing that constructs this type today has to
  // change in the same pass that introduces the seam.
  //
  // WARNING before removing `version` below: the load path in radio-log.service.ts tests
  // validity with `indexOf("version") <= 0`, a naive SUBSTRING search over the raw JSON.
  // Dropping that literal string resets every returning user's reports to defaults - the same
  // trap as [[settings-marker-field-trap]]. `schemaVersion` happens to contain the substring,
  // which is luck rather than design.
  schemaVersion?: number,
  version: string,
  date: Date,
  event: string,
  bounds: BoundsType,
  numReport: number,
  maxId: number,
  filter: string, // All reports or not? Guard to ensure a subset never gets writen to localstorage?
  logEntries: RadioLogEntryType[]
}

/**
 * Data to store for each radio log entry
 *
 * E-41 phase 1 (2026-08-26): five fields added for ICS-309/213 support - data collection
 * only, per the maintainer's own explicit scoping ("does not want export/reporting logic
 * built yet, only the fields and the model to hold them"). `source` is gathered on every
 * report, always. The four `*213` fields are opt-in per entry (`generates213` gates the
 * other three) - "the 213 stays opt-in per entry... the scribe should be able to click a
 * 'Yes, generate an ICS-213' [button/flag] from this message." All optional rather than a
 * schema-version bump: existing stored reports simply lack them (`undefined`), which is a
 * safe, already-correct answer for a plain `JSON.parse()` (radio-log.service.ts has no
 * migration path today, unlike MissionType) - nothing reads these fields yet, so there is
 * nothing for their absence to break. `message213`/`replyRequested213`/`recipients213` are
 * a best-effort answer to "whatever the 213's initial version requires" - now confirmed
 * against the real official ICS-213 AcroForm (E-31/E-41 phase 3, 2026-08-26 - see
 * `shared/export/ics213-pdf.ts`).
 *
 * `recipients213` changed from `string` to `string[]` the same day (maintainer, E-103
 * scoping): a per-mission definable checklist of routine recipients (Incident Commander, Ops
 * Section, EOC, ...) is coming, checkbox-shaped, and a list is the natural fit - a comma-
 * joined string would only need re-splitting once that lands. **No migration written or
 * needed** - the maintainer's own call: "This app is not currently in use." Entry still
 * collects free text today (the checkbox UI is E-103, not yet built); `mergedFormValue()`
 * splits the typed string into this array at the form/storage boundary.
 */
export type RadioLogEntryType = {
  // NOTE the two different identifiers below, deliberately named apart:
  //   `id`        - THIS REPORT's own sequential number (from RadioLogType.maxId).
  //   `rangerUid` - WHO filed it: a foreign key into RangerType.uid (ADR D-42).
  // An earlier reading of D-42 would have called the second one `id` too, which would have
  // collided head-on with this pre-existing field.
  id: number,
  /**
   * The ranger this report is filed against - a foreign key into `RangerType.uid`, replacing
   * `callsign` as the join key (ADR D-42).
   *
   * Points at the SURROGATE key, not the credential `RangerType.id`. Two reasons: the
   * credential can legitimately be blank (issued at check-in), and it can be corrected later
   * without silently re-pointing every report that referenced its old value.
   *
   * Deliberately not denormalized - the credential and callsign are reachable through the
   * ranger, so copying them onto the report would only create something that goes stale.
   * (`callsign` below is the exception, and for a different reason: evidence, not lookup.)
   */
  rangerUid?: string,
  // DELIBERATELY KEPT alongside `rangerId`, not replaced by it: a report can outlive the
  // ranger it names (deleted or re-keyed roster row), and the callsign is what the scribe
  // actually heard over the radio - the primary evidence of who reported. A report whose
  // callsign matches no current ranger keeps it, with an empty `rangerId`, rather than
  // being dropped or silently attached to the wrong person.
  callsign: string,
  // E-165 (2026-09-30): tactical call signs and a To station - field feedback from Vashon ARES
  // ("we are logging messages to tactical call signs ... the FCC callsign of the operator at
  // those positions is important for the paperwork but of very little importance real time").
  // All optional/additive, no radio-log schema bump: an older entry simply lacks them.
  //
  // RECORDED AT SAVE TIME, never looked up later - the same rule `operator` follows (F29-47 /
  // D-44, below). When a scribe picks the tactical call "Vashon EOC", Entry copies the assigned
  // operator's callsign into `callsign` and their uid into `rangerUid` right then; reassigning
  // "Vashon EOC" to someone else at shift change must not rewrite earlier entries. `callsign`
  // / `rangerUid` above stay the FROM station's FCC call and roster link.
  /** From station's tactical call, as chosen on Entry (the name as it was at save time). */
  tacticalCall?: string,
  /** To station's tactical call. */
  toTactical?: string,
  /** To station's FCC call - recorded from the assigned operator, or typed. */
  toCallsign?: string,
  /** To station's roster link, if it resolved to one. Same meaning as `rangerUid`. */
  toRangerUid?: string,
  //team: string,
  location: LocationType,
  date: Date,
  status: string,
  notes: string,
  source?: RadioLogEntrySource,
  generates213?: boolean,
  replyRequested213?: boolean,
  message213?: string,
  recipients213?: string[],
  // F29-47 (2026-08-29, ADR D-44): "5 Approved by Name"/ICS-309's Name-Position-Signature
  // header, whichever scribe actually filed the report. Deliberately optional, additive, no
  // schema bump - same shape as `source` above. Stamped at submit from whatever the entry
  // form showed at that moment (see entry.component.ts's operatorModel, deliberately NOT part
  // of that form's own resettable model) and NEVER retroactively looked up - rewriting who
  // logged a report after the fact is a records-integrity failure for a document (ICS-309)
  // whose whole purpose is who-logged-what-when. A report with no operator (predates this
  // field, or the scribe left it blank - both legitimate) renders blank; never substitute the
  // current session's operator for a missing one.
  operator?: string,
  /**
   * E-114 Phase 0 (2026-08-31): set ONLY on an entry that arrived via
   * RadioLogService.mergeIncomingEntries() (a Report Packet from a different device), never
   * on one created normally by addRadioLogEntry(). Stores the dedup key
   * (`<ranger identity>:<original id on the sending device>`) that identified it at merge
   * time, so importing the same packet again is recognized and skipped - a sending device's
   * own `id` is NOT trustworthy across devices on its own (two devices both start at 0; see
   * the roadmap's E-114 identity-prerequisite write-up), so this is not just `id` renamed.
   * Optional/additive - no schema bump needed, same pattern `operator`/`source`/
   * `MissionExport.locations?` already established.
   */
  sourceUid?: string,
  // F29-47 (2026-08-29): the ICS-213's "4 Subject" line, declared in ICS213_FIELDS since
  // E-31/E-41 phase 3 but never actually filled - it printed blank on every 213 generated.
  // A genuinely separate scribe-entered field (not derived from message213), placed last
  // inside the 213 section per the maintainer's own ask, so it inherits that section's
  // opt-in [hidden] behavior for free. Same additive/no-migration treatment as the other
  // *213 fields.
  subject213?: string,
  // Architecture decision, 2026-08-26: resolves the "second coordinate" question the Five
  // Open Questions discussion doc left open (topic 1/6) - where a clue/evidence item
  // actually IS, distinct from the reporting ranger's own position (`location` above).
  // Entered as range-and-bearing from the reporter (evidence-location.component.ts),
  // stored as the resulting absolute LocationType so the rest of the app (the map marker,
  // any future export) never needs to know how it was entered. Optional, same reasoning
  // as the E-41 fields above: no schema-version bump, a returning user's older reports
  // simply lack it.
  evidenceLocation?: LocationType | null,
  // Raised live 2026-08-30, tied directly to D-47 (reports/messages stay editable
  // indefinitely, no time lock): that ADR anticipated exactly this pair - "indefinitely
  // editable" and "visibly edited" - as the natural follow-on once it mattered in practice.
  // `revisedAt` is stamped whenever MessagesComponent's own edit form saves a change (NOT by
  // the Radio Log grid's cell edits - this is scoped to the Messages page's own new edit
  // capability, not a general audit trail for every field). Optional/additive, same
  // no-migration treatment as every other field added this way - a report with none simply
  // has never been edited there.
  revisedAt?: Date,
  // 2026-10-02, John (E-07 replay groundwork): when this entry was typed in on its own device,
  // stamped once by RadioLogService.addRadioLogEntry() and never edited (not a grid column).
  // `date` above is when the traffic happened and may be set back by a scribe catching up, so
  // the two together let a replay show late entries for what they are. A Report Packet entry
  // keeps the phone's own `loggedAt`, by that phone's clock. Optional/additive, no schema bump:
  // entries from before 0.99.18 have none.
  loggedAt?: Date,
  // Set the first time Print OR Save PDF succeeds for this report (messages.component.ts's
  // printAsIcs213()/saveIcs213Pdf(), split from one combined button 2026-09-28), and never
  // overwritten by a later reprint/re-save - it answers "has this gone out at all," not
  // "when was it last printed." Drives the "you're editing a message that may have already
  // been sent" warning - D-47's own "warning, not a block" policy, not a new one.
  printedAt?: Date,
}

/**
 * Radio Log entries can be tagged with a status. These can have color & associated icons & can be edited by the user.
 * ? FUTURE: Consider replacing "Color" with "CSS_Style" to allow more options?
 */
export type RadioLogStatusType = {
  status: string,
  color: string,
  icon: string
}
