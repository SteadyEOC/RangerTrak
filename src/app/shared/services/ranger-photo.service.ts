import { Injectable } from '@angular/core'

import { LogService } from './log.service'
// Direct import of the module-level singleton, not the RecordStore DI wrapper: this service's
// own constructor runs from Angular DI, same as everything else here, but reading the session
// key this way matches the "direct import for something DI can't reach yet" idiom
// record-store.ts's own doc comment describes - main.ts's unlock flow runs before any injector
// exists, and the key it derives has to be the SAME instance's key this service reads.
import { recordStore } from '../storage/record-store'
import { decryptPhoto, encryptPhoto } from '../storage/record-encryption'

/**
 * Ranger photographs, stored on THIS device only.
 *
 * D-35: a photograph of a volunteer is operator data, not an application asset. It never
 * goes in `src/assets/`, because that is a public repo and a public site, and git history
 * makes it a one-way door. A team leader loads the photos into their own command-post
 * browser before a mission, and they stay there.
 *
 * Why this exists at all (E-38): a photo beside the callsign is how a scribe confirms *who*
 * a report is about while entering it. The feature was removed when the repo went public
 * and never rebuilt, which cost a real field capability to solve a publishing problem.
 *
 * Two deliberate choices:
 *
 * 1. **Photos are downscaled on import.** They are rendered at 40px in the grid and 60px on
 *    the Entry form; the originals average ~400KB. Storing them at MAX_EDGE keeps a 200-photo
 *    roster in single-digit MB, which matters on a tablet that also holds map tiles.
 * 2. **Object URLs are built once, up front, into a synchronous map.** The three render
 *    sites are string-building cell renderers that cannot await anything, so the alternative
 *    would be rewriting all of them.
 *
 * D-42 phase 6: `build-roster-zip.js` (`rangertrak-InternalDocs/roster-build/`, outside this
 * repo) names photo files after a ranger's `callsign`, and bundles built by it may already be
 * in a team's hands. Matching tries a ranger's `id` stem first, then falls back to `callsign`,
 * for both import matching and lookup - never id-only, or every existing bundle orphans.
 */

// Exported for unlock-form.ts's "Forgot it" flow (E-122 Phase 2b): erasing this whole database
// directly is the equivalent of clear() with no service instance to call it on - main.ts runs
// before Angular's injector exists. See that file's own comment.
export const RANGER_PHOTOS_DB_NAME = 'rangertrak-photos'
const DB_VERSION = 1
const STORE = 'photos'
/** Longest edge kept, in pixels. Renders at 40-60px; this leaves room for retina and zoom. */
const MAX_EDGE = 320

/** The two filename-matchable identifiers a ranger may have. Either may be blank. */
export interface RangerPhotoIdentity {
  id?: string
  callsign?: string
}

/**
 * E-122 Phase 2b: what an encrypted photo looks like in the `photos` object store, in place
 * of the plain `Blob` stored there before. Not base64 - IndexedDB stores binary natively, so
 * the IV and ciphertext travel as themselves; see record-encryption.ts's own comment on why
 * that matters more here than for the small JSON strings RecordStore encrypts.
 */
interface EncryptedPhotoRecord {
  encrypted: true
  iv: Uint8Array<ArrayBuffer>
  mime: string
  data: ArrayBuffer
}

function isEncryptedPhotoRecord(value: unknown): value is EncryptedPhotoRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v['encrypted'] === true && v['data'] instanceof ArrayBuffer && v['iv'] instanceof Uint8Array
}

@Injectable({ providedIn: 'root' })
export class RangerPhotoService {

  private id = 'Ranger Photo Service'
  private db?: IDBDatabase

  /** callsign (upper-case) -> object URL. Synchronous, for the cell renderers. */
  private urls = new Map<string, string>()

  private ready: Promise<void>

  constructor(private log: LogService) {
    this.ready = this.open()
      .then(() => this.loadAll())
      .catch(e => this.log.warn(`Photos unavailable on this device: ${e?.message ?? e}`, this.id))
  }

  /** Resolves once stored photos have been read into memory. */
  whenReady(): Promise<void> { return this.ready }

  /** Object URL for a ranger's photo, or '' when there is none. Synchronous by design. */
  photoUrl(ranger: RangerPhotoIdentity): string {
    const byId = this.stem(ranger.id)
    if (byId && this.urls.has(byId)) return this.urls.get(byId)!
    const byCallsign = this.stem(ranger.callsign)
    if (byCallsign && this.urls.has(byCallsign)) return this.urls.get(byCallsign)!
    return ''
  }

  count(): number { return this.urls.size }

  /**
   * Every stored photo, as its raw Blob keyed by the same filename-matchable stem
   * `photoUrl()`/`importFiles()` use (a ranger's `id` if set, else `callsign`, uppercased).
   * E-109 Setup files v2 (2026-08-31): the only consumer today - bundling this device's
   * photos into a downloadable zip alongside the roster/settings. Fetches each already-
   * created object URL rather than re-reading IndexedDB, since `this.urls` is already the
   * in-memory source of truth `photoUrl()` itself trusts.
   */
  async allPhotoBlobs(): Promise<{ stem: string; blob: Blob }[]> {
    await this.ready
    const out: { stem: string; blob: Blob }[] = []
    for (const [stem, url] of this.urls) {
      try {
        out.push({ stem, blob: await (await fetch(url)).blob() })
      } catch (e: any) {
        this.log.warn(`allPhotoBlobs(): could not read stored photo "${stem}": ${e?.message ?? e}`, this.id)
      }
    }
    return out
  }

  /**
   * Stores photos picked from a folder. Matching is by FILENAME STEM, checked against every
   * ranger's `id` first and `callsign` second (D-42 phase 6) - `build-roster-zip.js` still
   * names files after `callsign`, and older bundles built by it must keep matching.
   *
   * Returns what happened, for a confirmation the operator can actually check.
   */
  async importFiles(files: File[], rangers: RangerPhotoIdentity[]): Promise<{ stored: string[], unmatched: string[] }> {
    await this.ready
    const byId = new Map(rangers.filter(r => r.id).map(r => [this.stem(r.id), r.id!]))
    const byCallsign = new Map(rangers.filter(r => r.callsign).map(r => [this.stem(r.callsign), r.callsign!]))
    const stored: string[] = []
    const unmatched: string[] = []

    for (const file of files) {
      const fileStem = this.stem(file.name.replace(/\.[^.]+$/, ''))
      const matched = byId.get(fileStem) ?? byCallsign.get(fileStem)
      if (!matched) { unmatched.push(file.name); continue }
      try {
        const blob = await this.downscale(file)
        await this.put(fileStem, blob)
        this.revoke(fileStem)
        this.urls.set(fileStem, URL.createObjectURL(blob))
        stored.push(matched)
      } catch (e: any) {
        this.log.error(`Could not store ${file.name}: ${e?.message ?? e}`, this.id)
        unmatched.push(file.name)
      }
    }

    this.log.info(`Stored ${stored.length} photos on this device; ${unmatched.length} unmatched.`, this.id)
    return { stored, unmatched }
  }

  private stem(s?: string): string { return String(s || '').trim().toUpperCase() }

  /** Forgets every stored photo. The roster is untouched. */
  async clear(): Promise<void> {
    await this.ready
    for (const cs of [...this.urls.keys()]) this.revoke(cs)
    this.urls.clear()
    if (!this.db) return
    await this.tx('readwrite', s => s.clear())
    this.log.warn('Deleted all ranger photos from this device.', this.id)
  }

  // ── internals ────────────────────────────────────────────────────────

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
      const req = indexedDB.open(RANGER_PHOTOS_DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => { this.db = req.result; resolve() }
      req.onerror = () => reject(req.error)
    })
  }

  /**
   * Resolves on `transaction.oncomplete`, not `req.onsuccess`. The request event fires when
   * the individual read/write is queued and answered, which for a `readwrite` transaction is
   * BEFORE the browser has actually committed the write to disk - a caller that reloads the
   * page right after `await`ing this can tear down a transaction that never committed, and
   * the write is silently lost. Waiting for the transaction to complete costs nothing for the
   * `readonly` callers (`loadAll()`), so one code path covers both.
   */
  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('photo store not open')); return }
      const transaction = this.db.transaction(STORE, mode)
      const req = fn(transaction.objectStore(STORE))
      let result: T
      req.onsuccess = () => { result = req.result }
      req.onerror = () => reject(req.error)
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(transaction.error ?? req.error ?? new Error('photo store transaction aborted'))
      transaction.onerror = () => reject(transaction.error ?? req.error ?? new Error('photo store transaction error'))
    })
  }

  /**
   * E-122 Phase 2b: encrypts under the session key when one is set (RecordStore's roster is
   * encrypted, and this device has been unlocked), else stores the plain Blob exactly as
   * before. `recordStore.getEncryptionKey()` is read fresh on every call rather than cached -
   * it can go from unset to set (Enable) or vice versa (Disable) mid-session; see those flows
   * in mission-advanced-options.component.ts, which handle the ALREADY-STORED photos via
   * encryptAll()/decryptAll() below rather than this method.
   */
  private async put(callsign: string, blob: Blob) {
    const key = recordStore.getEncryptionKey()
    if (!key) return this.tx('readwrite', s => s.put(blob, callsign))
    const record = await this.toEncryptedRecord(key, blob)
    return this.tx('readwrite', s => s.put(record, callsign))
  }

  private async toEncryptedRecord(key: CryptoKey, blob: Blob): Promise<EncryptedPhotoRecord> {
    const plaintext = await blob.arrayBuffer()
    const { iv, ciphertext } = await encryptPhoto(key, plaintext)
    return { encrypted: true, iv, mime: blob.type || 'application/octet-stream', data: ciphertext }
  }

  private async loadAll(): Promise<void> {
    if (!this.db) return
    const keys = await this.tx<IDBValidKey[]>('readonly', s => s.getAllKeys())
    const stored = await this.tx<unknown[]>('readonly', s => s.getAll())
    for (let i = 0; i < keys.length; i++) {
      const stem = String(keys[i]).toUpperCase()
      const value = stored[i]
      if (value instanceof Blob) {
        this.urls.set(stem, URL.createObjectURL(value))
        continue
      }
      if (!isEncryptedPhotoRecord(value)) continue
      const key = recordStore.getEncryptionKey()
      if (!key) {
        // Same "treat as missing, never a boot failure" rule RecordStore.load() follows -
        // this device is either still locked (shouldn't happen; main.ts unlocks before this
        // service ever constructs) or this photo predates a key this session never got.
        this.log.warn(`Photo "${stem}" is encrypted but no key is available this session; skipping.`, this.id)
        continue
      }
      try {
        const plaintext = await decryptPhoto(key, value.iv, value.data)
        this.urls.set(stem, URL.createObjectURL(new Blob([plaintext], { type: value.mime })))
      } catch (e: any) {
        this.log.error(`Could not decrypt stored photo "${stem}": ${e?.message ?? e}`, this.id)
      }
    }
    if (this.urls.size) this.log.info(`Loaded ${this.urls.size} ranger photos from this device.`, this.id)
  }

  /**
   * Re-encrypts every photo already on this device under `key` - the Enable half of Mission >
   * Data safety, called right after `RecordStore.enableEncryption()` resolves (that call is
   * what derives `key` in the first place). Reads back through the already-decrypted object
   * URLs (`this.urls`) rather than re-opening IndexedDB, the same shortcut `allPhotoBlobs()`
   * already takes and for the same reason: they are already the in-memory source of truth.
   */
  async encryptAll(key: CryptoKey): Promise<void> {
    await this.ready
    if (!this.db) return
    for (const [stem, url] of this.urls) {
      try {
        const blob = await (await fetch(url)).blob()
        const record = await this.toEncryptedRecord(key, blob)
        await this.tx('readwrite', s => s.put(record, stem))
      } catch (e: any) {
        this.log.error(`Could not encrypt stored photo "${stem}": ${e?.message ?? e}`, this.id)
      }
    }
    this.log.warn(`Encrypted ${this.urls.size} ranger photos on this device.`, this.id)
  }

  /**
   * Reverses encryptAll(): decrypts every stored photo back to a plain Blob - the Disable half
   * of Mission > Data safety. Called with the already-verified key
   * (`RecordStore.verifyPassphrase()`) BEFORE `RecordStore.disableEncryption()` clears session
   * state, since this method (unlike encryptAll()) has to read the CURRENTLY-encrypted bytes
   * back out of IndexedDB rather than off an in-memory object URL - `this.urls` already holds
   * plaintext object URLs regardless of what is on disk (loadAll() decrypts into them at
   * startup), so re-reading raw IndexedDB is the only way to reach the still-encrypted form.
   */
  async decryptAll(key: CryptoKey): Promise<void> {
    await this.ready
    if (!this.db) return
    const keys = await this.tx<IDBValidKey[]>('readonly', s => s.getAllKeys())
    const stored = await this.tx<unknown[]>('readonly', s => s.getAll())
    let count = 0
    for (let i = 0; i < keys.length; i++) {
      const stem = String(keys[i])
      const value = stored[i]
      if (!isEncryptedPhotoRecord(value)) continue
      try {
        const plaintext = await decryptPhoto(key, value.iv, value.data)
        await this.tx('readwrite', s => s.put(new Blob([plaintext], { type: value.mime }), stem))
        count++
      } catch (e: any) {
        this.log.error(`Could not decrypt stored photo "${stem}" while disabling encryption: ${e?.message ?? e}`, this.id)
      }
    }
    this.log.warn(`Decrypted ${count} ranger photos on this device.`, this.id)
  }

  private revoke(callsign: string) {
    const existing = this.urls.get(callsign)
    if (existing) URL.revokeObjectURL(existing)
  }

  /** Shrinks to MAX_EDGE, preserving aspect. Falls back to the original on any failure. */
  private async downscale(file: File): Promise<Blob> {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
      if (scale === 1) { bitmap.close?.(); return file }

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { bitmap.close?.(); return file }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close?.()

      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
      return blob ?? file
    } catch {
      // A device without createImageBitmap still gets its photos, just larger.
      return file
    }
  }
}
