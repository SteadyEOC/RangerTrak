import { rehydrateDateFields } from './json-dates'
import { RADIO_LOG_ENTRY_DATE_FIELDS, rehydrateHandled } from './radio-log-migration'
import { bumpHighWater, findMsgNoClashes, nextMsgNo } from './msg-no'
import type { MsgNoContext } from './msg-no'
import { mergeAttachmentRefs } from './attachments'
import { newUid } from './uid'
import { withSanitizedHeading } from './heading'
import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'

/**
 * Merges radio log entries that came from another device into this device's own list
 * (ADR D-59, E-188; the logic that used to live in `RadioLogService.mergeIncomingEntries()`).
 *
 * Pure (D-57): no injection, no logging, no storage. Inputs are not mutated.
 *
 * **Matching.** An incoming entry that carries a `uid` matches an existing entry with the same
 * `uid`, and only that: two senders' entries that happen to share a display `id` and a ranger
 * are different entries and both stay. An incoming entry with NO `uid` (a Report Packet from a
 * build before D-59) falls back to the E-114 key, `sourceUid` = `<ranger identity>:<sender's id>`.
 *
 * **A match.** Same `revisedAt` or both missing: unchanged. The incoming one revised later (an
 * entry never revised counts as older than any revision): the existing entry is updated in
 * place and keeps its display `id`, its `uid` and its merged-in mark. The existing one revised
 * later: unchanged. Attachments (ADR D-60, E-194) are the exception to "the later copy wins": on
 * any match they become the union by fingerprint (`mergeAttachmentRefs`), so a merge never drops
 * one and a removal sticks. An entry otherwise unchanged whose merged attachments differ counts
 * as updated. The revisedAt rule applies to uid matches only; a `sourceUid` match is
 * always "unchanged", as E-114 behaved.
 *
 * **No match.** Appended with a new display `id` from `nextId`, the incoming `uid` kept (or a
 * new one minted for an entry that had none) and `sourceUid` stamped so the 📦 mark shows.
 *
 * **rangerUid.** `uidRemap` (from `mergeRangers()`) is applied first, to `rangerUid` and
 * `toRangerUid`. `reporterCredential` / `resolvedUid` (E-114 section 1a) fill a missing
 * `rangerUid` on a Report Packet. A hand-over must NOT pass them: its operator is the scribe,
 * not the ranger (D-44), and each entry keeps its own `operator`.
 *
 * **Message numbers (E-220, D-68).** An incoming entry with a `msgNo` keeps it. One without (a phone's
 * Report Packet, a console catch-up file) gets this device's next number when it is first appended, when
 * `msgNo` context is given. A matched entry never has its number changed. The result names any incoming
 * number that is already on a different entry here (`clashes`); nothing is renumbered. `handled` (E-218):
 * on a match the later `at` wins, whichever copy is otherwise kept.
 */
export type EntryMergeOptions = {
  /** The display `id` the first appended entry will get (the device's `maxId`). */
  nextId: number
  /** Incoming ranger uid -> the uid this device kept (`mergeRangers().uidRemap`). */
  uidRemap?: Record<string, string>
  /** The normalised credential the packet named, used only in the E-114 `sourceUid` key. */
  reporterCredential?: string
  /** The roster uid that credential resolved to, used when an entry names no ranger. */
  resolvedUid?: string
  /** This device's mission, op period and station letter, for stamping an entry that has no number. */
  msgNo?: MsgNoContext
  /** The log's high-water map, so a stamped number is never one that was handed out before. */
  msgNoHighWater?: Record<string, number>
}

export type EntryMergeNote = { id: number, uid: string, callsign: string, reason?: string }

export type EntryMergeResult = {
  entries: RadioLogEntryType[]
  /** The `nextId` for the next merge (the device's new `maxId`). */
  nextId: number
  added: number
  /** Entries matched and replaced because the incoming one was revised later. */
  updated: number
  /** Matched entries where nothing needed to change. */
  unchanged: number
  rejected: number
  /** Named, so the summary can say which (never just a count). */
  updatedNotes: EntryMergeNote[]
  rejectedNotes: EntryMergeNote[]
  /** Incoming numbers already held by a different entry here (D-68). Both keep their numbers. */
  clashes: Array<{ msgNo: string, uids: [string, string] }>
  /** The high-water map after stamping (the input one when nothing was stamped). */
  msgNoHighWater?: Record<string, number>
}

/** Why an incoming entry cannot be merged, or null when it is fine (moved from RadioLogService). */
export function invalidIncomingEntryReason(entry: RadioLogEntryType): string | null {
  if (typeof entry.id !== 'number' || !Number.isFinite(entry.id)) {
    return 'id is not a number'
  }
  if (typeof entry.callsign !== 'string' || typeof entry.status !== 'string') {
    return 'callsign or status is not text'
  }
  if (entry.uid !== undefined && (typeof entry.uid !== 'string' || !entry.uid.trim())) {
    return 'uid is not text'
  }
  if (isNaN(new Date(entry.date).getTime())) {
    return `not a valid timestamp: ${JSON.stringify(entry.date)}`
  }
  if (!isValidCoordinate(entry.location)) {
    return 'location is missing or out of range'
  }
  if (entry.evidenceLocation && !isValidCoordinate(entry.evidenceLocation)) {
    return 'evidenceLocation is out of range'
  }
  return null
}

function isValidCoordinate(location: { lat: number, lng: number } | null | undefined): boolean {
  return !!location
    && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
    && Number.isFinite(location.lng) && location.lng >= -180 && location.lng <= 180
}

/** E-218: when the mark last changed on this copy: set (`handled.at`) or cleared (`handledClearedAt`). */
function handledMs(entry: RadioLogEntryType): number {
  const ms = (d: Date | undefined) => {
    const t = d ? new Date(d).getTime() : NaN
    return Number.isFinite(t) ? t : -Infinity
  }
  return Math.max(ms(entry.handled?.at), ms(entry.handledClearedAt))
}

function revisedMs(entry: RadioLogEntryType): number {
  const t = entry.revisedAt ? new Date(entry.revisedAt).getTime() : NaN
  return Number.isFinite(t) ? t : -Infinity   // never revised = older than any revision
}

export function mergeEntries(
  existing: readonly RadioLogEntryType[],
  incoming: readonly RadioLogEntryType[],
  opts: EntryMergeOptions,
): EntryMergeResult {
  const entries = existing.map(e => ({ ...e }))
  const byUid = new Map<string, number>()
  const bySourceUid = new Set<string>()
  entries.forEach((e, i) => {
    if (e.uid) byUid.set(e.uid, i)
    if (e.sourceUid) bySourceUid.add(e.sourceUid)
  })

  let nextId = opts.nextId
  let msgNoHighWater = opts.msgNoHighWater
  let added = 0
  let updated = 0
  let unchanged = 0
  const updatedNotes: EntryMergeNote[] = []
  const rejectedNotes: EntryMergeNote[] = []
  const remap = (uid: string | undefined) => (uid && opts.uidRemap?.[uid]) || uid

  for (const raw of incoming) {
    const reason = invalidIncomingEntryReason(raw)
    if (reason) {
      rejectedNotes.push({ id: raw?.id, uid: raw?.uid ?? '', callsign: String(raw?.callsign ?? ''), reason })
      continue
    }

    // Dates arrive as ISO strings from a JSON file; validating is not converting.
    // E-268: a bad clue heading is cleaned to null, not a reason to reject the whole entry.
    const entry = withSanitizedHeading(rehydrateHandled(rehydrateDateFields({ ...raw }, [...RADIO_LOG_ENTRY_DATE_FIELDS])))
    if (entry.rangerUid) entry.rangerUid = remap(entry.rangerUid)
    if (entry.toRangerUid) entry.toRangerUid = remap(entry.toRangerUid)

    const matchIndex = entry.uid ? byUid.get(entry.uid) : undefined
    if (matchIndex !== undefined) {
      const current = entries[matchIndex]
      const attachments = mergeAttachmentRefs(current.attachments, entry.attachments)
      const attachmentsChanged = JSON.stringify(attachments)
        !== JSON.stringify(mergeAttachmentRefs(current.attachments, []))
      const withAttachments = (e: RadioLogEntryType): RadioLogEntryType =>
        (attachments.length ? { ...e, attachments } : e)
      // E-218: the later status-mark change wins (a clear included), whichever copy the other fields come from.
      const markFrom = handledMs(entry) > handledMs(current) ? entry : current
      const withHandled = (e: RadioLogEntryType): RadioLogEntryType => {
        const out = { ...e }
        if (markFrom.handled) out.handled = markFrom.handled
        else delete out.handled
        if (markFrom.handledClearedAt) out.handledClearedAt = markFrom.handledClearedAt
        else delete out.handledClearedAt
        return out
      }
      const handledChanged = markFrom !== current
      if (revisedMs(entry) > revisedMs(current)) {
        // Keep this device's display id, uid, number and merged-in mark; take the rest from the later copy.
        entries[matchIndex] = withHandled(withAttachments({
          ...entry, id: current.id, uid: current.uid, sourceUid: current.sourceUid,
          ...((current.msgNo ?? entry.msgNo) ? { msgNo: current.msgNo ?? entry.msgNo } : {}),
        }))
        updated++
        updatedNotes.push({ id: current.id, uid: current.uid ?? '', callsign: entry.callsign })
      } else if (attachmentsChanged) {
        // The other side's fields lose, but its attachments still arrive.
        entries[matchIndex] = withHandled(withAttachments(current))
        updated++
        updatedNotes.push({ id: current.id, uid: current.uid ?? '', callsign: current.callsign, reason: 'attachments' })
      } else if (handledChanged) {
        entries[matchIndex] = withHandled(current)
        updated++
        updatedNotes.push({ id: current.id, uid: current.uid ?? '', callsign: current.callsign, reason: 'status mark' })
      } else {
        unchanged++
      }
      continue
    }

    // The E-114 key uses the sender's ranger identity as it was, before any remap.
    const identity = raw.rangerUid || opts.reporterCredential || 'unknown'
    const sourceUid = `${identity}:${raw.id}`
    if (!entry.uid && bySourceUid.has(sourceUid)) {
      unchanged++
      continue
    }

    const uid = entry.uid || newUid()
    const fresh: RadioLogEntryType = { ...entry, id: nextId++, uid, sourceUid }
    if (!fresh.rangerUid && opts.resolvedUid) fresh.rangerUid = opts.resolvedUid
    if (!fresh.msgNo && opts.msgNo) {
      // D-68: a phone or console entry has no number; it gets this device's next one, once.
      fresh.msgNo = nextMsgNo(entries, msgNoHighWater, opts.msgNo)
      msgNoHighWater = bumpHighWater(msgNoHighWater, fresh.msgNo)
    } else if (fresh.msgNo && opts.msgNo) {
      // A numbered entry keeps its number; the mark still covers it so a later number here skips past it.
      msgNoHighWater = bumpHighWater(msgNoHighWater, fresh.msgNo)
    }
    entries.push(fresh)
    byUid.set(uid, entries.length - 1)
    bySourceUid.add(sourceUid)
    added++
  }

  const existingNumbered = existing.filter(e => e.msgNo)
  const clashes = existingNumbered.length
    ? findMsgNoClashes(existingNumbered, incoming.filter(e => !invalidIncomingEntryReason(e)))
    : []

  return {
    entries, nextId, added, updated, unchanged,
    rejected: rejectedNotes.length, updatedNotes, rejectedNotes, clashes, msgNoHighWater,
  }
}
