/**
 * E-222 / ADR D-67: the mission journal - a per-device, append-only record of actions that change,
 * replace, delete or send mission data. Each entry carries the SHA-256 of the entry before it, so a
 * later edit, deletion or reordering shows as "broken at entry N". That catches accidental damage and
 * casual edits; the device's owner holds the storage, so it is not proof against someone determined.
 * The outside anchor is paper: shortHead() is printed on the 309, the Summary and the map sheet.
 *
 * Pure: no Angular, no storage. The service is shared/services/mission-journal.service.ts.
 *
 * Events, never contents: a summary may name call signs, counts, file names, scenario and mission
 * names - never entry or note text, addresses, passphrases or keys.
 */

export const MISSION_JOURNAL_SCHEMA_VERSION = 1
export const JOURNAL_GENESIS = '0'.repeat(64)
export const JOURNAL_MAX_ENTRIES = 5000

/** Every action the journal records. kebab-case; the Log page and the ICS-214 suggestions key off these. */
export type JournalAction =
  | 'journal-started'
  | 'demo-loaded' | 'real-mission-started' | 'demo-left' | 'mode-changed' | 'scenario-clock-set'
  | 'mission-reset' | 'mission-restored' | 'import-undone' | 'encryption-on' | 'encryption-off'
  | 'radio-log-cleared' | 'report-reassigned' | 'reports-merged' | 'handover-built' | 'handover-merged' | 'packet-exported' | 'radio-log-exported'
  | 'print-309' | 'print-213' | 'print-213-auto' | 'pdf-213-saved'
  | 'attachments-removed' | 'attachments-restored'
  | 'roster-cleared' | 'rangers-deleted' | 'roster-imported' | 'roster-exported' | 'print-roster' | 'photos-exported'
  | 'roster-changes-exported' | 'photos-imported' | 'photos-cleared'
  | 'places-imported' | 'places-exported' | 'print-places' | 'layer-removed' | 'print-map'
  | 'custom-map-stored' | 'custom-map-cleared'
  | 'setup-file-built' | 'setup-file-applied' | 'backup-exported' | 'backup-attachments-exported'
  | 'export-214' | 'aar-notes-cleared' | 'print-aar' | 'aar-exported' | 'print-summary' | 'summary-exported'
  | 'board-publishing-changed' | 'board-password-changed' | 'board-attachment-sent' | 'feedback-sent'
  | 'journal-exported' | 'debug-log-exported'

export interface JournalEntry {
  seq: number            // 1, 2, 3 ... never reused, survives trimming
  at: string             // ISO, set at record time
  action: JournalAction
  summary: string        // one plain sentence, events not contents
  mission: string        // mission name at the time ('' if none)
  mode: string           // 'demo' | 'exercise' | 'incident' at the time ('' if not chosen)
  prev: string           // hash of the previous entry (JOURNAL_GENESIS for the first ever)
  hash: string           // sha256Hex(canonical(entry without hash))
}

export type JournalDraft = Pick<JournalEntry, 'action' | 'summary' | 'mission' | 'mode'>

export type StoredMissionJournal = { schemaVersion: number, entries: JournalEntry[] }

export interface JournalCheck {
  ok: boolean
  count: number
  /** Entries trimmed off the front (first kept seq - 1). */
  trimmedBefore: number
  /** seq of the first entry that does not match; set only when ok is false. */
  brokenAt?: number
  /** Hash of the newest entry (JOURNAL_GENESIS for an empty journal). */
  head: string
}

/**
 * Entries worth offering as ICS-214 lines (D-67 item 8): mission and data actions. Left out: the
 * 213 print (the scribe already logs the message), and the journal's own bookkeeping.
 */
export const SUGGEST_FOR_214: ReadonlySet<JournalAction> = new Set<JournalAction>([
  'demo-loaded', 'real-mission-started', 'demo-left', 'mode-changed', 'mission-reset', 'mission-restored',
  'import-undone', 'encryption-on', 'encryption-off', 'radio-log-cleared', 'reports-merged', 'handover-built', 'handover-merged',
  'packet-exported', 'radio-log-exported', 'print-309', 'roster-cleared', 'rangers-deleted', 'roster-imported', 'roster-exported',
  'print-roster', 'photos-exported', 'roster-changes-exported', 'photos-imported', 'photos-cleared',
  'places-imported', 'places-exported', 'print-places', 'print-map', 'setup-file-built', 'setup-file-applied',
  'backup-exported', 'backup-attachments-exported', 'aar-notes-cleared', 'print-aar', 'aar-exported',
  'print-summary', 'summary-exported', 'board-attachment-sent',
])

/** The hashed text: the fields in a fixed order, so the hash does not depend on key order. */
export function canonical(e: Omit<JournalEntry, 'hash'>): string {
  return JSON.stringify([e.seq, e.at, e.action, e.summary, e.mission, e.mode, e.prev])
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/**
 * Synchronous SHA-256 of the UTF-8 bytes of `text`, as 64 lowercase hex characters. Synchronous on
 * purpose (D-67 item 5): some actions reload the page straight after recording, and crypto.subtle is
 * async and absent on non-secure origins. Its spec checks the standard vectors and crypto.subtle.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const bitLen = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  return Array.from(h, x => x.toString(16).padStart(8, '0')).join('')
}

/** Adds one entry after the last, chained to it, and trims the oldest beyond the cap. */
export function appendEntry(list: readonly JournalEntry[], draft: JournalDraft, now: Date): JournalEntry[] {
  const last = list[list.length - 1]
  const base = {
    seq: last ? last.seq + 1 : 1,
    at: now.toISOString(),
    action: draft.action,
    summary: draft.summary,
    mission: draft.mission,
    mode: draft.mode,
    prev: last ? last.hash : JOURNAL_GENESIS,
  }
  const next = [...list, { ...base, hash: sha256Hex(canonical(base)) }]
  return next.length > JOURNAL_MAX_ENTRIES ? next.slice(next.length - JOURNAL_MAX_ENTRIES) : next
}

/**
 * Checks every hash and that each `prev` is the hash before it. The first kept entry's `prev` is
 * trusted: when the oldest were trimmed, what it points at is gone.
 */
export function verifyJournal(list: readonly JournalEntry[]): JournalCheck {
  const count = list.length
  const head = count ? list[count - 1].hash : JOURNAL_GENESIS
  const trimmedBefore = count ? Math.max(0, list[0].seq - 1) : 0
  for (let i = 0; i < count; i++) {
    const { hash, ...rest } = list[i]
    const chained = i === 0 || rest.prev === list[i - 1].hash
    if (!chained || hash !== sha256Hex(canonical(rest))) {
      return { ok: false, count, trimmedBefore, brokenAt: list[i].seq, head }
    }
  }
  return { ok: true, count, trimmedBefore, head }
}

/** The printed form: `jrnl 3f9a·c21b (143)` - first and last four hex characters, then the count. */
export function shortHead(head: string, count: number): string {
  return `jrnl ${head.slice(0, 4)}·${head.slice(-4)} (${count})`
}

function isEntry(raw: unknown): raw is JournalEntry {
  if (!raw || typeof raw !== 'object') return false
  const e = raw as Record<string, unknown>
  return typeof e['seq'] === 'number' && typeof e['at'] === 'string' && typeof e['action'] === 'string'
    && typeof e['summary'] === 'string' && typeof e['mission'] === 'string' && typeof e['mode'] === 'string'
    && typeof e['prev'] === 'string' && typeof e['hash'] === 'string'
}

/**
 * Accepts whatever storage or a backup holds - nothing, or the versioned wrapper - and returns the
 * current shape. Entries are NOT repaired (a repaired entry would no longer match its hash); only
 * things that are not entries at all are dropped. A wrapper from a newer schema passes through.
 */
export function migrateMissionJournal(raw: unknown): StoredMissionJournal {
  if (!raw || typeof raw !== 'object') return { schemaVersion: MISSION_JOURNAL_SCHEMA_VERSION, entries: [] }
  const incoming = raw as { schemaVersion?: unknown, entries?: unknown }
  const entries = Array.isArray(incoming.entries) ? incoming.entries.filter(isEntry) : []
  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0
  return { schemaVersion: Math.max(version, MISSION_JOURNAL_SCHEMA_VERSION), entries }
}

/** Plain-words result line for the Log page. */
export function describeCheck(check: JournalCheck): string {
  if (check.count === 0) return 'The journal is empty.'
  const latest = `${check.head.slice(0, 4)}…${check.head.slice(-4)}`
  if (!check.ok) return `Journal broken at entry ${check.brokenAt}`
  if (check.trimmedBefore > 0) {
    const first = check.trimmedBefore + 1
    return `Intact from entry ${first.toLocaleString('en-US')} (${check.trimmedBefore.toLocaleString('en-US')} earlier entries trimmed), latest ${latest}`
  }
  return `Journal intact: ${check.count.toLocaleString('en-US')} entries, latest ${latest}`
}

const CSV_HEADINGS = ['seq', 'at', 'mission', 'mode', 'action', 'summary', 'prev', 'hash']

/** Every field, same quoting as LogService.toCsv() (RFC 4180: all quoted, quotes doubled). */
export function journalToCsv(list: readonly JournalEntry[]): string {
  const q = (f: unknown) => `"${String(f).replace(/"/g, '""')}"`
  return [
    CSV_HEADINGS.join(','),
    ...list.map(e => [e.seq, e.at, e.mission, e.mode, e.action, e.summary, e.prev, e.hash].map(q).join(',')),
  ].join('\r\n')
}
