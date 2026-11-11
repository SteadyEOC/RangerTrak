/**
 * E-251/E-253 (2026-11-11, ADR D-69): the three states of a field phone's own report - not sent,
 * sent, received - kept as one map, uid -> record, in `FieldModeService` (storage key
 * `fieldModeReports`). Pure (D-57): no injection, no storage; every function returns a new map.
 *
 * `sentAt: null` means "sent at a time we don't know" (folded in from the older
 * `fieldModeSentUids` list). A uid that is not in the map is not sent. Received is reached by a
 * receipt from the command post (E-260) or a hand mark, and never goes back to sent.
 */
export type FieldReportRecord = {
  sentAt: string | null
  receivedAt?: string
  msgNo?: string
}
export type FieldReportMap = Readonly<Record<string, FieldReportRecord>>
export type FieldReportState = 'not-sent' | 'sent' | 'received'

type WithUid = { uid?: string }

/** Anything unreadable (not JSON, not an object, bad records) reads as empty / skipped. */
export function parseFieldReports(raw: string | null): FieldReportMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, FieldReportRecord> = {}
    for (const [uid, r] of Object.entries(parsed as Record<string, unknown>)) {
      if (!r || typeof r !== 'object') continue
      const rec = r as Record<string, unknown>
      const next: FieldReportRecord = { sentAt: typeof rec['sentAt'] === 'string' ? rec['sentAt'] : null }
      if (typeof rec['receivedAt'] === 'string') next.receivedAt = rec['receivedAt']
      if (typeof rec['msgNo'] === 'string') next.msgNo = rec['msgNo']
      out[uid] = next
    }
    return out
  } catch {
    return {}
  }
}

/** The old `fieldModeSentUids` list (a JSON array of uids) as records with an unknown send time. */
export function foldSentUids(raw: string | null, into: FieldReportMap = {}): FieldReportMap {
  const out: Record<string, FieldReportRecord> = { ...into }
  try {
    const list = JSON.parse(raw ?? '[]')
    if (Array.isArray(list)) {
      for (const u of list) {
        if (typeof u === 'string' && !out[u]) out[u] = { sentAt: null }
      }
    }
  } catch { /* unreadable reads as nothing sent */ }
  return out
}

export function stateOf(map: FieldReportMap, uid: string | undefined): FieldReportState {
  const rec = uid ? map[uid] : undefined
  if (!rec) return 'not-sent'
  return rec.receivedAt ? 'received' : 'sent'
}

export function newEntries<T extends WithUid>(map: FieldReportMap, entries: readonly T[]): T[] {
  return entries.filter(e => stateOf(map, e.uid) === 'not-sent')
}

/** Sent, but not yet received. */
export function unconfirmedEntries<T extends WithUid>(map: FieldReportMap, entries: readonly T[]): T[] {
  return entries.filter(e => stateOf(map, e.uid) === 'sent')
}

export function receivedEntries<T extends WithUid>(map: FieldReportMap, entries: readonly T[]): T[] {
  return entries.filter(e => stateOf(map, e.uid) === 'received')
}

/** Sending again updates `sentAt`; a received report stays received and keeps its mark. */
export function withSent(map: FieldReportMap, uids: readonly string[], at: Date): FieldReportMap {
  const out: Record<string, FieldReportRecord> = { ...map }
  for (const uid of uids) {
    const prev = out[uid]
    out[uid] = prev ? { ...prev, sentAt: at.toISOString() } : { sentAt: at.toISOString() }
  }
  return out
}

/** Returns the new map and how many reports changed (an already received one does not count). */
export function withReceived(
  map: FieldReportMap,
  uids: readonly string[],
  at: Date,
  msgNos?: ReadonlyMap<string, string>,
): { map: FieldReportMap, changed: number } {
  const out: Record<string, FieldReportRecord> = { ...map }
  let changed = 0
  for (const uid of uids) {
    const prev = out[uid]
    if (prev?.receivedAt) continue
    const msgNo = msgNos?.get(uid)
    out[uid] = { sentAt: prev ? prev.sentAt : null, receivedAt: at.toISOString(), ...(msgNo ? { msgNo } : {}) }
    changed++
  }
  return { map: out, changed }
}

export function withoutReports(map: FieldReportMap, uids: readonly string[]): FieldReportMap {
  const drop = new Set(uids)
  return Object.fromEntries(Object.entries(map).filter(([uid]) => !drop.has(uid)))
}
