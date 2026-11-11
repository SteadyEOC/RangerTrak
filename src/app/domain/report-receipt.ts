/**
 * E-260 (2026-11-11, ADR D-69): the receipt. The command post makes it after merging a Report
 * Packet; the field phone opens it and marks those reports Received. One small text file that
 * travels the way the packet did.
 *
 * Rule 5: it carries uids and message numbers ONLY. No report text, names, locations or photos.
 * The mission name and station letter are labels for a person reading the file name or header.
 *
 * Pure (D-57): no injection, no storage, no clock (the caller passes `now`).
 */
import { stripBom } from './import-diagnosis'
import { formatMsgNoShort, type MsgNo } from './msg-no'

export const REPORT_RECEIPT_KIND = 'rangertrak-report-receipt'
export const REPORT_RECEIPT_SCHEMA_VERSION = 1

export type ReceiptEntry = { uid: string, msgNo: string }

export type ReportReceipt = {
  kind: typeof REPORT_RECEIPT_KIND
  schemaVersion: number
  madeAt: string
  appVersion: string
  mission: string
  station: string
  entries: ReceiptEntry[]
}

/** The only parts of a log entry a receipt looks at. */
type LogEntryLike = { uid?: string, msgNo?: MsgNo }

/**
 * Every packet uid now present in this log (added or already there), with the short message number
 * it holds here. A uid that is not in the log (rejected) is left out.
 */
export function buildReceipt(params: {
  packetUids: readonly string[]
  logEntries: readonly LogEntryLike[]
  mission: string
  station: string
  appVersion: string
  now: Date
}): ReportReceipt {
  const byUid = new Map<string, LogEntryLike>()
  for (const e of params.logEntries) if (e.uid) byUid.set(e.uid, e)
  const seen = new Set<string>()
  const entries: ReceiptEntry[] = []
  for (const uid of params.packetUids) {
    if (seen.has(uid)) continue
    const held = byUid.get(uid)
    if (!held) continue
    seen.add(uid)
    entries.push({ uid, msgNo: formatMsgNoShort(held.msgNo) })
  }
  return {
    kind: REPORT_RECEIPT_KIND,
    schemaVersion: REPORT_RECEIPT_SCHEMA_VERSION,
    madeAt: params.now.toISOString(),
    appVersion: params.appVersion,
    mission: params.mission,
    station: params.station,
    entries,
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `rangertrak-receipt-<mission>-2026-11-11-1432.txt`, in the device's own time zone. */
export function receiptFilename(mission: string, madeAt: string | Date): string {
  const d = madeAt instanceof Date ? madeAt : new Date(madeAt)
  const label = (mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `rangertrak-receipt-${label}-${stamp}.txt`
}

export type ParsedReceipt =
  | { ok: true, receipt: ReportReceipt, skipped: number }
  | { ok: false, message: string }

/** Plain messages; a bad row is skipped and counted, and only a receipt with no usable row fails. */
export function parseReceipt(text: string): ParsedReceipt {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch {
    return { ok: false, message: 'This file is not a receipt. It could not be read.' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'This file is not a receipt.' }
  }
  const obj = parsed as Record<string, unknown>
  if (obj['kind'] !== REPORT_RECEIPT_KIND) {
    if (typeof obj['schemaVersion'] === 'number' && Array.isArray(obj['entries'])) {
      return { ok: false, message: 'This is a Report Packet, not a receipt. Send it from the phone with Send, and open the receipt the command post sends back.' }
    }
    return { ok: false, message: 'This file is not a receipt.' }
  }
  const version = obj['schemaVersion']
  if (typeof version !== 'number' || version > REPORT_RECEIPT_SCHEMA_VERSION) {
    return { ok: false, message: 'This receipt is from a newer RangerTrak. Update this app, then open it again.' }
  }
  const rows = Array.isArray(obj['entries']) ? obj['entries'] as unknown[] : []
  const entries: ReceiptEntry[] = []
  let skipped = 0
  for (const r of rows) {
    const row = r as Record<string, unknown> | null
    if (row && typeof row === 'object' && typeof row['uid'] === 'string' && row['uid']
      && (row['msgNo'] === undefined || typeof row['msgNo'] === 'string')) {
      entries.push({ uid: row['uid'], msgNo: (row['msgNo'] as string | undefined) ?? '' })
    } else {
      skipped++
    }
  }
  if (!entries.length) {
    return { ok: false, message: rows.length ? 'This receipt has no readable reports in it.' : 'This receipt lists no reports.' }
  }
  const str = (v: unknown): string => typeof v === 'string' ? v : ''
  return {
    ok: true,
    skipped,
    receipt: {
      kind: REPORT_RECEIPT_KIND, schemaVersion: version, madeAt: str(obj['madeAt']),
      appVersion: str(obj['appVersion']), mission: str(obj['mission']), station: str(obj['station']), entries,
    },
  }
}
