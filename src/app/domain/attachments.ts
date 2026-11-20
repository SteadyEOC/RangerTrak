import type { RadioLogEntryType } from './model/radio-log-entry.interface'

/**
 * Attachments on radio log entries (ADR D-60, E-194): the reference an entry carries.
 *
 * Pure (D-57): no injection, no logging, no storage. The bytes live elsewhere
 * (`AttachmentStoreService`, keyed by `sha256`); an entry only ever holds this reference, so
 * every format that carries entries carries the references with no extra work.
 *
 * Times are ISO strings, not `Date`: a reference is merged and compared as plain data and
 * travels through JSON files, so there is nothing to rehydrate.
 */
export type AttachmentRef = {
  /** SHA-256 of the original bytes as received, lowercase hex. The identity of the attachment. */
  sha256: string
  name: string
  /** MIME type as the browser reported it. */
  type: string
  size: number
  /** The file's own `lastModified`, when the browser gave one. */
  capturedAt?: string
  addedAt: string
  /** The operator who attached it, as on the entry itself (D-44). */
  addedBy: string
  /** Set when removed: the bytes are gone but the trace stays (D-60 item 5). Sticky in merges. */
  removed?: { at: string, by: string }
  /**
   * Set when this file was made smaller (D-60 item 2, revised 2026-10-17). The reference names the
   * smaller copy's own bytes; `fromSha256` is the original's fingerprint, taken first, so a
   * camera-roll copy can still be matched to it. `where` says who made it: the sender at Attach,
   * or a receiver from the viewer. Additive and optional: no migration.
   */
  compressed?: { fromSha256: string, fromSize: number, fromType: string, at: string, by: string, where: 'sender' | 'receiver' }
  /**
   * Set on an ORIGINAL a receiver replaced with a smaller copy (typed REPLACE). It counts like
   * `removed` (not live, bytes released) and is sticky in merges. `bySha256` is the copy's fingerprint.
   */
  replaced?: { at: string, by: string, bySha256: string }
}

export type BudgetLevel = 'ok' | 'warn80' | 'over'

export type BudgetUsage = {
  usedBytes: number
  pct: number
  level: BudgetLevel
}

type HasAttachments = Pick<RadioLogEntryType, 'attachments'>

function earlier(a: string, b: string): boolean {
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta < tb
  return a < b
}

function byAddedThenSha(a: AttachmentRef, b: AttachmentRef): number {
  if (a.addedAt !== b.addedAt) return earlier(a.addedAt, b.addedAt) ? -1 : 1
  return a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0
}

/**
 * Union by `sha256`. Never drops a reference. `removed` and `replaced` are sticky: marked on either
 * side means marked, and the earlier mark is kept. A smaller copy and its original are different
 * fingerprints, so they are two references and the union keeps both. Where both sides name the same file, the one added
 * first supplies `name`/`addedAt`/`addedBy` (a tie keeps `a`'s). Stable order: `addedAt`, then
 * `sha256`. Inputs are not mutated.
 */
export function mergeAttachmentRefs(
  a: readonly AttachmentRef[] | undefined,
  b: readonly AttachmentRef[] | undefined,
): AttachmentRef[] {
  const bySha = new Map<string, AttachmentRef>()
  for (const ref of [...(a ?? []), ...(b ?? [])]) {
    const seen = bySha.get(ref.sha256)
    if (!seen) { bySha.set(ref.sha256, { ...ref }); continue }
    const base = earlier(ref.addedAt, seen.addedAt) ? { ...ref } : seen
    const marks = [seen.removed, ref.removed].filter((m): m is NonNullable<AttachmentRef['removed']> => !!m)
    if (marks.length) base.removed = { ...marks.reduce((x, y) => (earlier(y.at, x.at) ? y : x)) }
    const swaps = [seen.replaced, ref.replaced].filter((m): m is NonNullable<AttachmentRef['replaced']> => !!m)
    if (swaps.length) base.replaced = { ...swaps.reduce((x, y) => (earlier(y.at, x.at) ? y : x)) }
    // First seen wins, as for `name`; a side that has no note does not erase the other's.
    const note = base.compressed ?? seen.compressed ?? ref.compressed
    if (note) base.compressed = { ...note }
    bySha.set(ref.sha256, base)
  }
  return [...bySha.values()].sort(byAddedThenSha)
}

/** Removed, or replaced by a smaller copy: the reference stays as a trace, the bytes do not. */
export function isGone(ref: Pick<AttachmentRef, 'removed' | 'replaced'>): boolean {
  return !!ref.removed || !!ref.replaced
}

/** The references not marked removed or replaced. */
export function liveRefs(entry: HasAttachments): AttachmentRef[] {
  return (entry.attachments ?? []).filter(r => !isGone(r))
}

/** Whether this reference is a smaller copy of something (made by the sender or a receiver). */
export function isSmallerCopy(ref: Pick<AttachmentRef, 'compressed'>): boolean {
  return !!ref.compressed
}

/**
 * The same label, for a reference in its entry: it says "original replaced" when a receiver replaced
 * the original this copy was made from, and "original kept" otherwise.
 */
export function smallerCopyLabelIn(entry: HasAttachments, ref: Pick<AttachmentRef, 'sha256' | 'compressed'>): string {
  const kept = !(entry.attachments ?? []).some(r => r.replaced?.bySha256 === ref.sha256)
  return smallerCopyLabel(ref, kept)
}

/** A file name with "(smaller copy)" after it when it is one: for CSV files and lists that show names alone. */
export function nameWithKind(ref: Pick<AttachmentRef, 'name' | 'compressed'>): string {
  return ref.compressed ? `${ref.name} (smaller copy)` : ref.name
}

/**
 * The line that says which kind a file is, wherever it is shown (viewer, hover preview, prints,
 * RangerView). '' for an original. The sender's names whose phone made it; the receiver's says the
 * original was kept (or, when replaced, that it was not).
 */
export function smallerCopyLabel(ref: Pick<AttachmentRef, 'compressed'>, originalKept = true): string {
  const c = ref.compressed
  if (!c) return ''
  const from = formatBytes(c.fromSize)
  const who = c.by.trim()
  if (c.where === 'sender') return who ? `Smaller copy, made on ${who}'s phone from ${from}` : `Smaller copy, made on the sender's phone from ${from}`
  return `Smaller copy made by ${who || 'the operator'} from ${from}${originalKept ? '; original kept' : '; original replaced'}`
}

/** Every fingerprint any entry names, live and removed: the set whose bytes must be kept. */
export function referencedFingerprints(entries: readonly HasAttachments[]): Set<string> {
  const out = new Set<string>()
  for (const e of entries) for (const r of e.attachments ?? []) out.add(r.sha256)
  return out
}

/**
 * The stored fingerprints no reference on the device names. The one rule for deleting bytes
 * (D-60 item 8): a removed-but-referenced fingerprint is NOT an orphan.
 */
export function orphans(storedKeys: Iterable<string>, entries: readonly HasAttachments[]): string[] {
  const kept = referencedFingerprints(entries)
  return [...storedKeys].filter(k => !kept.has(k))
}

/**
 * The stored fingerprints that only REMOVED references name: nothing live wants the bytes any
 * more. D-60 item 5 ("the bytes go, the reference stays") is carried out by deleting exactly
 * these, when a person removes an attachment or a merge brings a removal in. Never a fingerprint
 * with no reference at all (that is `orphans()`'s, with its own reasons) and never one a live
 * reference still names.
 */
export function removedOnly(storedKeys: Iterable<string>, entries: readonly HasAttachments[]): string[] {
  const named = referencedFingerprints(entries)
  const live = new Set<string>()
  for (const e of entries) for (const r of liveRefs(e)) live.add(r.sha256)
  return [...storedKeys].filter(k => named.has(k) && !live.has(k))
}

/**
 * Space used against the mission budget. Each stored fingerprint counts once, however many
 * entries name it, and only fingerprints a live reference names count (removed ones have no
 * bytes). Level 'warn80' from 80%, 'over' from 100%.
 */
export function budgetUsage(
  entries: readonly HasAttachments[],
  sizesBySha: Readonly<Record<string, number>>,
  budgetBytes: number,
): BudgetUsage {
  const live = new Set<string>()
  for (const e of entries) for (const r of liveRefs(e)) live.add(r.sha256)
  let usedBytes = 0
  for (const sha of live) usedBytes += sizesBySha[sha] ?? 0
  const pct = budgetBytes > 0 ? (usedBytes / budgetBytes) * 100 : (usedBytes > 0 ? Infinity : 0)
  const level: BudgetLevel = pct >= 100 ? 'over' : pct >= 80 ? 'warn80' : 'ok'
  return { usedBytes, pct, level }
}

/** The short form: the first 8 and last 4 hex characters (`3f9a12c0…b71e`). */
export function formatFingerprint(sha: string): string {
  return sha.length <= 12 ? sha : `${sha.slice(0, 8)}…${sha.slice(-4)}`
}

/** One live attachment as a printout lists it: its name, the short fingerprint, and whether a thumbnail applies. */
export type PrintAttachment = { name: string, fingerprint: string, sha256: string, isImage: boolean, smallerCopy?: string }

/** What a print (ICS-213, ICS-309, summary) lists for an entry: each live attachment, in the entry's stable order. */
export function printAttachments(entry: HasAttachments): PrintAttachment[] {
  return liveRefs(entry).map(r => ({
    name: r.name, fingerprint: formatFingerprint(r.sha256), sha256: r.sha256, isImage: r.type.startsWith('image/'),
    ...(r.compressed ? { smallerCopy: smallerCopyLabelIn(entry, r) } : {}),
  }))
}

/** Bytes per megabyte: the budget setting is in MB and so is every figure shown beside it. */
export const BYTES_PER_MB = 1024 * 1024

/** "412 KB", "41 MB", "1.2 GB": short, for confirms and the budget line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < BYTES_PER_MB) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * BYTES_PER_MB) {
    const mb = bytes / BYTES_PER_MB
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  }
  return `${(bytes / (1024 * BYTES_PER_MB)).toFixed(1)} GB`
}
