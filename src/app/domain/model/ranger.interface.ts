// `address` (home address) was removed 2026-08-26 (maintainer): confirmed by grepping every
// consumer that it was never read by any feature - only ever displayed/edited/exported as a
// plain grid column, unlike phone/rew/image which the Entry autocomplete and map markers
// actually use. Genuine PII with zero functional payoff. See ADR/roadmap for the fuller
// reasoning, including why this doesn't meaningfully change the roster's overall exposure
// (a callsign already resolves to more via the FCC's own public ULS lookup) except for
// photographs, which aren't part of any public record.
// ADR D-42 gives a ranger THREE distinct identifiers. They are not interchangeable, and
// conflating them is the mistake this comment exists to prevent:
//
//   uid      - internal surrogate key. App-minted, always present, never shown, never edited.
//              THIS is what radio log entries join on.
//   id       - the real-world credential (REW-0038 / TEW-1003). Issued by the incident at
//              check-in, NOT by this app. May legitimately be blank.
//   callsign - radio terminology. What a scribe hears and types. May be blank; plenty of
//              CERT/MERT responders are not ham-licensed.
//
// The surrogate exists precisely because the other two can both be blank. Keying the join on
// either would reproduce the exact gap D-42 set out to close.
export interface RangerType {
  /**
   * Internal surrogate key - the ranger/report join key (ADR D-42).
   *
   * App-minted, unlike `id`: a `uid` has no real-world meaning and answers to no outside
   * authority, so this app is free to generate one. That asymmetry is the whole point of
   * having a surrogate at all.
   *
   * A UUID rather than a counter, deliberately. The roadmap already flags the multi-scribe
   * merge problem - "two devices independently incrementing their own counter will collide
   * the moment their logs merge" - and a mission export moving between devices is exactly
   * that scenario. A UUID needs no coordination.
   *
   * Never displayed and never editable. It must survive export/import unchanged, or every
   * report's `rangerUid` orphans.
   *
   * OPTIONAL during the migration only; `ranger-migration.ts` guarantees one on load. Tighten
   * to required once every write path populates it.
   */
  uid?: string
  /**
   * The real-world credential number - `REW-0038` (Registered Emergency Worker, or a state
   * equivalent) or `TEW-1003` (Temporary Emergency Worker).
   *
   * **Issued at check-in by the incident, never minted by this app.** A blank value is a
   * legitimate, expected state meaning "has not checked in yet" - surfaced as a warning, not
   * filled in with something invented. See `normalizeRangerIds()`.
   *
   * Replaces the WA-specific `rew` column (ADR D-42); displayed and searchable, but NOT the
   * join key - that is `uid`.
   */
  id?: string
  callsign: string
  fullName: string
  phone: string
  image: string
  team: string
  role: string
  note: string
}

export const UnknownRanger: RangerType = {
  callsign: "Unknown",
  fullName: "Unknown Ranger",
  phone: "",
  image: "",
  team: "",
  role: "",
  note: "Unknown Ranger entered. Go to Rangers page & enter new folks there!",
}
