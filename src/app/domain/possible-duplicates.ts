import { formatMsgNoShort } from './msg-no'
import type { MsgNo } from './msg-no'

/**
 * E-306 rung 1: possible duplicates across stations.
 *
 * Two stations that both hear the same transmission each log it. When their logs are merged the
 * result holds two entries for one message. This finds likely pairs and NOTHING more: it never
 * merges, hides, edits or deletes anything. The scribe decides.
 *
 * A pair is two entries that
 *  - were logged under DIFFERENT station letters (so they are not one scribe's repeated traffic), and
 *  - name the same call sign (trimmed, case-insensitive), or the same tactical call, and
 *  - are within `windowMs` of each other (default 5 minutes). Each station's own clock is used
 *    as logged; clocks drift, so the window is deliberately loose and nothing is reordered by it.
 *
 * Pure (D-57): no injection, no storage.
 */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000

export interface DuplicateCandidate {
  date: Date | string
  callsign?: string
  tacticalCall?: string
  msgNo?: MsgNo
}

export interface DuplicatePair<T extends DuplicateCandidate> { a: T, b: T }

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase()

function sharesCall(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const ca = norm(a.callsign), cb = norm(b.callsign)
  if (ca && ca === cb) return true
  const ta = norm(a.tacticalCall), tb = norm(b.tacticalCall)
  return !!ta && ta === tb
}

/** Every possible-duplicate pair among `entries`, each pair once, earlier entry first. */
export function findPossibleDuplicates<T extends DuplicateCandidate>(
  entries: readonly T[], windowMs: number = DUPLICATE_WINDOW_MS,
): DuplicatePair<T>[] {
  const stamped = entries
    .filter(e => !!e.msgNo?.station)
    .map(e => ({ e, t: new Date(e.date).getTime() }))
    .filter(x => Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t)
  const out: DuplicatePair<T>[] = []
  for (let i = 0; i < stamped.length; i++) {
    for (let j = i + 1; j < stamped.length; j++) {
      if (stamped[j].t - stamped[i].t > windowMs) break
      const a = stamped[i].e, b = stamped[j].e
      if (a.msgNo!.station === b.msgNo!.station) continue
      if (sharesCall(a, b)) out.push({ a, b })
    }
  }
  return out
}

/** What a row shows about one possible duplicate of it. */
export interface DuplicateNote { msgNo: string, time: Date }

/** For each entry that is in a pair: the other entries it may duplicate (short number and that entry's own time). */
export function duplicateNotes<T extends DuplicateCandidate>(pairs: readonly DuplicatePair<T>[]): Map<T, DuplicateNote[]> {
  const out = new Map<T, DuplicateNote[]>()
  const add = (from: T, other: T) => {
    const list = out.get(from) ?? []
    list.push({ msgNo: formatMsgNoShort(other.msgNo), time: new Date(other.date) })
    out.set(from, list)
  }
  for (const { a, b } of pairs) { add(a, b); add(b, a) }
  return out
}

/** "B and C", "A, B and C": the station letters in `pairs`, sorted. '' for none. */
export function duplicateStationsPhrase(pairs: readonly DuplicatePair<DuplicateCandidate>[]): string {
  const letters = [...new Set(pairs.flatMap(p => [p.a.msgNo?.station, p.b.msgNo?.station]).filter((s): s is string => !!s))].sort()
  if (letters.length < 2) return letters.join('')
  return `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`
}

/** "2 possible duplicates (heard at B and C)". '' for none. */
export function duplicateSummarySentence(pairs: readonly DuplicatePair<DuplicateCandidate>[]): string {
  if (!pairs.length) return ''
  return `${pairs.length} possible duplicate${pairs.length === 1 ? '' : 's'} (heard at ${duplicateStationsPhrase(pairs)})`
}
