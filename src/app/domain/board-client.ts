import { liveRefs, smallerCopyLabelIn } from './attachments'
import type { AttachmentRef } from './attachments'

/**
 * The scribe's side of the Board (ADR D-61, D-60 item 6): the pure parts of
 * `CommandPostPublishService`. No fetch, no storage, no timers (D-57), so the whole claim /
 * re-claim / replaced story can be tested without a server. `tools/board/protocol.js` is the
 * server half and the source of truth for the replies read here.
 */

/** What the Mission card shows. `replaced`: another device holds the Board; this one has stopped. */
export type BoardState = 'off' | 'claiming' | 'publishing' | 'replaced' | 'error'

/** Who is publishing, as the claim sends it and the server's replies echo it back. */
export type BoardBy = { mission: string, opPeriod: string, scribe: string, agent: string }

/** Who holds the Board now. Both are absent when the server will not say. */
export type BoardHolder = { by?: BoardBy, at?: string }

// ---- the state machine ----

export type BoardEvent =
  /** Publishing was switched on, or the app started with it on. */
  | { type: 'start', hasKey: boolean, wasReplaced: boolean }
  | { type: 'stop' }
  /** A person pressed Take over. */
  | { type: 'takeOver' }
  /** A claim or re-claim was accepted. */
  | { type: 'claimed' }
  /** The stored key still works. */
  | { type: 'keyGood' }
  /** The stored key was checked and the server has no claim at all: it restarted since. */
  | { type: 'keyUnknown' }
  /** A keyed call got 409 unclaimed: the server restarted and forgot us. */
  | { type: 'unclaimed' }
  /** The reply to a re-claim was 409 claimed: somebody else already holds the Board. */
  | { type: 'heldByOther' }
  /** A keyed call got 403 replaced: a takeover cut this key off. */
  | { type: 'replaced' }
  /** The claim could not be made (wrong password, rate limit, no server). `takeOver`: it was a person's Take over. */
  | { type: 'refused', takeOver?: boolean }

/** What the service does next: a claim, a claim marked `reclaim`, a key check, or a full snapshot. */
export type BoardAction = 'claim' | 'reclaim' | 'check' | 'publish'

export type BoardStep = { state: BoardState, next?: BoardAction }

/**
 * One transition. An event that makes no sense in the current state changes nothing, which is
 * what lets a late reply from a request sent before the state moved on do no harm.
 */
export function boardStep(state: BoardState, event: BoardEvent): BoardStep {
  switch (event.type) {
    case 'start':
      if (event.wasReplaced) return { state: 'replaced' }
      return { state: 'claiming', next: event.hasKey ? 'check' : 'claim' }
    case 'stop':
      return { state: 'off' }
    case 'takeOver':
      return state === 'replaced' ? { state: 'claiming', next: 'claim' } : { state }
    case 'claimed':
    case 'keyGood':
      return state === 'claiming' ? { state: 'publishing', next: 'publish' } : { state }
    case 'keyUnknown':
      return state === 'claiming' ? { state: 'claiming', next: 'reclaim' } : { state }
    case 'unclaimed':
      // Only a publishing device re-claims. While one is already claiming, another 409 is the
      // same restart seen twice, and a second re-claim would find our own claim and call it a rival's.
      return state === 'publishing' ? { state: 'claiming', next: 'reclaim' } : { state }
    case 'heldByOther':
    case 'replaced':
      return state === 'claiming' || state === 'publishing' ? { state: 'replaced' } : { state }
    case 'refused':
      // A refused Take over leaves the person where they were, with the Take over button, not in an error.
      if (state !== 'claiming') return { state }
      return { state: event.takeOver ? 'replaced' : 'error' }
  }
}

// ---- reading the server's replies ----

export const WRONG_PASSWORD_MESSAGE = 'This Board has a password. Check it with whoever runs the Board.'

export type ClaimReply =
  | { kind: 'ok', key: string }
  | { kind: 'heldByOther', holder: BoardHolder }
  | { kind: 'refused', message: string }

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
}

function holderOf(body: Record<string, unknown>): BoardHolder {
  const by = asRecord(body['by'])
  return {
    ...(Object.keys(by).length ? {
      by: {
        mission: String(by['mission'] ?? ''), opPeriod: String(by['opPeriod'] ?? ''),
        scribe: String(by['scribe'] ?? ''), agent: String(by['agent'] ?? ''),
      },
    } : {}),
    ...(typeof body['at'] === 'string' ? { at: body['at'] } : {}),
  }
}

/** The reply to POST /api/claim. */
export function readClaimReply(status: number, body: unknown): ClaimReply {
  const b = asRecord(body)
  if (status === 200 && typeof b['key'] === 'string' && b['key']) return { kind: 'ok', key: b['key'] }
  if (status === 409) return { kind: 'heldByOther', holder: holderOf(b) }
  if (status === 403 && b['needPassword']) return { kind: 'refused', message: WRONG_PASSWORD_MESSAGE }
  if (status === 429) {
    const wait = Number(b['retryAfter'])
    return { kind: 'refused', message: `Too many wrong passwords. Wait ${Number.isFinite(wait) && wait > 0 ? `${wait} seconds` : 'a minute'} and try again.` }
  }
  return { kind: 'refused', message: `The Board refused the claim (HTTP ${status}).` }
}

export type KeyedReply =
  | { kind: 'ok' }
  | { kind: 'unclaimed' }
  | { kind: 'replaced', holder: BoardHolder }
  | { kind: 'other', status: number }

/** The reply to any call that carries the publish key. */
export function readKeyedReply(status: number, body: unknown): KeyedReply {
  if (status >= 200 && status < 300) return { kind: 'ok' }
  if (status === 409) return { kind: 'unclaimed' }
  if (status === 403) return { kind: 'replaced', holder: holderOf(asRecord(body)) }
  return { kind: 'other', status }
}

// ---- who is publishing ----

/** A short "Chrome on Windows" for the claim. `brands` and `platform` come from `navigator.userAgentData`. */
export function describeAgent(ua: string, brands?: readonly { brand: string }[], platform?: string): string {
  const real = (brands ?? []).map(b => b.brand).filter(b => !/Not.?A.?Brand/i.test(b))
  const browser = (real.find(b => b !== 'Chromium') ?? real[0])
    ?? (/Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : '')
  const system = platform
    || (/Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
          : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
            : /CrOS/.test(ua) ? 'ChromeOS'
              : /Linux/.test(ua) ? 'Linux' : '')
  const name = browser.replace(/^Google /, '').replace(/^Microsoft /, '')
  if (name && system) return `${name} on ${system}`
  return name || system || 'Unknown browser'
}

/** The sentence on the Mission card and the notice when another device takes the Board. */
export function replacedMessage(holder: BoardHolder | undefined): string {
  const by = holder?.by
  const who = by && (by.scribe || by.agent)
    ? ` (${[by.scribe, by.agent].filter(Boolean).join(', ')}${holder?.at ? `, ${clockOf(holder.at)}` : ''})`
    : ''
  return `Another device publishes to this Board now${who}.`
}

function clockOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ---- the snapshot's attachments (D-60 item 6) ----

/** Past this much thumbnail text the oldest reports lose theirs, well under the server's 25 MB body. */
export const THUMB_BUDGET_BYTES = 15 * 1024 * 1024

/** `smallerCopy` is the label that says which kind a file is ("Smaller copy, made on K7ABC's phone from 4.2 MB"); absent for an original. */
export type BoardAttachment = { sha256: string, name: string, type: string, size: number, thumb?: string, smallerCopy?: string }

/** The attachment fields of one published report: a count only, or the references. */
export type BoardAttachmentFields =
  | { attachmentCount: number }
  | { attachments: BoardAttachment[] }

/**
 * Off: a count of live references and nothing else, so the server holds no fingerprint a viewer
 * could ask for. On: the live references, each with its thumbnail when one is on hand.
 */
export function attachmentFields(
  entry: { attachments?: AttachmentRef[] },
  show: boolean,
  thumbs: ReadonlyMap<string, string>,
): BoardAttachmentFields | Record<string, never> {
  const live = liveRefs(entry)
  if (!live.length) return {}
  if (!show) return { attachmentCount: live.length }
  return {
    attachments: live.map((a): BoardAttachment => {
      const thumb = thumbs.get(a.sha256)
      const smallerCopy = smallerCopyLabelIn(entry, a)
      return { sha256: a.sha256, name: a.name, type: a.type, size: a.size, ...(thumb ? { thumb } : {}), ...(smallerCopy ? { smallerCopy } : {}) }
    }),
  }
}

// ---- the snapshot's ICS-213 messages (E-228 phase 1) ----

/** A 213 as the Board shows it: the form's own fields, and when it first went out on paper or PDF. */
export type BoardIcs213 = { to: string[], subject: string, message: string, replyRequested: boolean, approvedBy: string, printedAt?: string }

/**
 * The 213 of one published report, or nothing for an entry that is not one. The same fields the
 * printed form carries (`ics213FieldsFromReport`); `approvedBy` is the operator, as on the form.
 */
export function ics213Fields(entry: {
  generates213?: boolean, recipients213?: string[], subject213?: string, message213?: string,
  replyRequested213?: boolean, operator?: string, printedAt?: Date | string,
}): { ics213: BoardIcs213 } | Record<string, never> {
  if (!entry.generates213) return {}
  const printed = entry.printedAt ? new Date(entry.printedAt) : undefined
  return {
    ics213: {
      to: (entry.recipients213 ?? []).filter(x => x.trim()),
      subject: entry.subject213 ?? '',
      message: entry.message213 ?? '',
      replyRequested: !!entry.replyRequested213,
      approvedBy: entry.operator ?? '',
      ...(printed && !isNaN(printed.getTime()) ? { printedAt: printed.toISOString() } : {}),
    },
  }
}

/**
 * Keeps the total thumbnail text within `budget` by dropping `thumb` from the oldest report
 * first (reports are passed oldest first). Returns how many thumbnails went. Mutates the
 * attachments it is given, which the caller built for this one publish.
 */
export function trimThumbs(
  reports: readonly { attachments?: BoardAttachment[] }[],
  budget = THUMB_BUDGET_BYTES,
): number {
  let total = 0
  for (const r of reports) for (const a of r.attachments ?? []) total += a.thumb?.length ?? 0
  let dropped = 0
  for (const r of reports) {
    for (const a of r.attachments ?? []) {
      if (total <= budget) return dropped
      if (!a.thumb) continue
      total -= a.thumb.length
      delete a.thumb
      dropped++
    }
  }
  return dropped
}
