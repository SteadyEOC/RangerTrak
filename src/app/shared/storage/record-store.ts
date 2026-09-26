import { Injectable, signal } from '@angular/core'

import {
  ENCRYPTED_KEYS, ENCRYPTION_MARKER_KEY, EncryptionMarker, createEncryptionMarker,
  decryptRecordValue, encryptRecordValue, isEncryptedEnvelope, isEncryptionMarker,
  unlockWithPassphrase,
} from './record-encryption'

/**
 * E-122 Phase 2a: the async, IndexedDB-backed replacement for using `localStorage` directly
 * to hold the app's personal-data keys (roster, field reports, locations).
 *
 * THE PROBLEM THIS SOLVES
 * ------------------------
 * `RangerService`, `RadioLogService` and `MissionLocationService` each keep their real state
 * in memory and write it out through exactly one persist method
 * (`updateLocalStorageAndPublish()` / `updateRadioLogAndPublish()`), read back exactly once,
 * synchronously, in their constructor. Moving that one write off `localStorage` (synchronous)
 * onto IndexedDB (asynchronous) would normally force every one of those methods - and every
 * caller of them - to go async. This store exists so none of that has to change: it looks
 * synchronous to every caller, and is IndexedDB underneath.
 *
 * HOW: a synchronous in-memory `Map` is the single source of truth for `getItem()`/
 * `setItem()`/`removeItem()`. A `setItem()`/`removeItem()` call updates the Map immediately
 * and queues a write to IndexedDB; a burst of calls for the SAME key before that write goes
 * out is coalesced down to one (last value wins) - see `scheduleFlush()`. The Map is filled
 * once, up front, by `load()`, which `main.ts` awaits before Angular boots
 * (`bootstrapApplication()`), so every service constructor's synchronous `getItem()` already
 * sees real data - no component or service-caller code needs to change.
 *
 * WHY A MODULE-LEVEL SINGLETON WRAPPED BY AN INJECTABLE, NOT JUST AN INJECTABLE
 * ------------------------------------------------------------------------------
 * `main.ts` calls `recordStore.load()` before `bootstrapApplication()` - before an Angular
 * injector exists, so nothing DI-provided is reachable yet there. The state that call
 * populates has to be the SAME state `RangerService` etc. read moments later once Angular
 * does exist. A plain `@Injectable` can't do that (there is no injector to ask before
 * bootstrap); a bare module-level singleton can, but then nothing is injectable for a future
 * Angular consumer that wants one via DI (a component, a test that overrides it). This file
 * does both from one implementation: `recordStore` is the real, stateful singleton (import it
 * directly, the way `main.ts` and the three domain services do - the same "direct import to
 * avoid a cycle/for something DI can't reach yet" idiom `radio-log.service.ts` already uses
 * for `RangerService`); `RecordStore` is a thin `providedIn: 'root'` class that forwards to
 * that exact same instance, for any Angular code that would rather inject it.
 *
 * WHAT LIVES HERE VS. WHAT STAYS ON localStorage
 * ------------------------------------------------
 * Only `MIGRATED_KEYS` below (the roster, the radio log, its `-BAD` quarantine copy, and
 * locations) are ever moved out of `localStorage`. Mission settings (`appSettings`) and every
 * UI-preference key (theme, skin, field mode, welcome panel, update, last-coordinate-format,
 * the Rangers privacy-notice dismissal flag, ...) are deliberately untouched and keep reading/
 * writing `localStorage` directly - they hold no roster PII, and Settings in particular has a
 * documented history of breaking returning users on any storage-shape change. This store is
 * not a general `localStorage` replacement; it exists for exactly the keys that hold PII.
 *
 * WHY NO ANGULAR `LogService` HERE
 * -----------------------------------
 * `load()` runs before Angular's injector exists (see above), so nothing DI-provided -
 * including `LogService` - is available yet. Plain `console.*` is used throughout, the same
 * as `main.ts` itself already does for the Angular/CDK version banner.
 *
 * PHASE 2b: OPT-IN ENCRYPTION AT REST
 * --------------------------------------
 * Built on top of this store rather than instead of it: the in-memory `Map` above is ALWAYS
 * plaintext (nothing here changes for `RangerService`/`RadioLogService`, which still read and
 * write plain JSON strings), and encryption is purely a property of what sits on either side
 * of it. `load()` decrypts right after `idbGet()`; `drain()`/`migrateOne()` encrypt right
 * before `idbPut()`. Only `ENCRYPTED_KEYS` (the roster and field reports - see
 * `record-encryption.ts`) are ever touched; `locations` and every `localStorage`-only key stay
 * in the clear, same as before.
 *
 * The derived key is a non-extractable `CryptoKey` held only in the `key` field below - never
 * written anywhere, never logged. `main.ts` calls `checkEncryption()` before `load()` to learn
 * whether a passphrase is needed at all (a plaintext marker record answers that without
 * decrypting anything), then `unlock()` once the operator has typed it. See
 * `shared/storage/unlock-form.ts` for the plain-DOM form that calls both, and
 * `record-encryption.ts`'s own header comment for the marker/verifier/per-write-IV design.
 */

// Exported for record-store.spec.ts only: it verifies migration/persistence by reading the
// real IndexedDB database independently of this module's own internals, which needs the DB/
// store name, and it seeds/asserts against exactly these keys for the "returning user" case.
export const DB_NAME = 'rangertrak-records'
export const STORE = 'kv'

/**
 * The only keys `load()` ever moves out of `localStorage`, one time, on this store's first
 * successful load. `'radioLog-BAD'` rides along with `'radioLog'` because
 * `RadioLogService.loadRadioLogFromLocalStorage()`'s own corruption-quarantine copy carries
 * the exact same raw field-report PII the primary key does - leaving it behind in
 * `localStorage` while its sibling moves would defeat the point.
 */
export const MIGRATED_KEYS = ['rangers', 'radioLog', 'radioLog-BAD', 'locations'] as const

/**
 * The real implementation, and the module-level singleton this file exports as `recordStore`.
 * Not exported itself - `recordStore` (the one instance) and `RecordStore` (the DI wrapper
 * around it) are the only two things anything outside this file should touch. See this file's
 * own header comment for why both exist.
 */
class RecordStoreImpl {

  /** Synchronous source of truth for every getItem()/setItem()/removeItem() call. */
  private readonly map = new Map<string, string>()

  /** Per-key coalesced write queue: the LAST value queued for a key wins. `null` = delete. */
  private readonly pending = new Map<string, string | null>()
  private flushQueued = false

  /**
   * Every queued drain, chained one after another so at most one IndexedDB write pass is ever
   * running at a time (a fresh drain always waits for the previous one, rather than the two
   * racing against each other on the same object store). `flush()` awaits this directly.
   */
  private writeChain: Promise<void> = Promise.resolve()

  private db?: IDBDatabase
  private dbAvailable = true
  private openPromise?: Promise<void>

  /**
   * Set once `checkEncryption()` has read the plaintext marker record (E-122 Phase 2b).
   * `undefined` means "no marker" - either encryption was never enabled, or it hasn't been
   * checked yet this session.
   *
   * A signal, not a plain field: this app runs zoneless (`provideZonelessChangeDetection()`,
   * app.config.ts), so Angular has no zone.js patch to notice a plain field changing inside an
   * `async` method's post-`await` continuation - only a signal write schedules the check that
   * updates a template reading it (Mission > Data safety's Enable/Disable button, via
   * `isEncryptionEnabled()` below). `RecordStoreImpl` otherwise avoids Angular imports (this
   * file's own header comment explains why - `load()` runs before an injector exists), but
   * `signal()` is a plain reactive primitive, not DI, so it works the same here as anywhere.
   */
  private readonly markerSignal = signal<EncryptionMarker | undefined>(undefined)
  private get marker(): EncryptionMarker | undefined { return this.markerSignal() }
  private set marker(value: EncryptionMarker | undefined) { this.markerSignal.set(value) }

  /**
   * The derived AES-GCM key for this session, non-extractable, held only here - never
   * persisted, never logged. Set by `unlock()` (real passphrase, before boot),
   * `enableEncryption()` (fresh key) or `verifyPassphrase()`'s caller assigning it back in
   * (disable flow). `undefined` means every `ENCRYPTED_KEYS` read/write happens in the clear -
   * true for a device that never enabled encryption, and briefly true again while a wrong
   * passphrase is being retried at the lock screen.
   */
  private key?: CryptoKey

  /**
   * Reads (and caches) the plaintext encryption marker, WITHOUT touching `MIGRATED_KEYS` -
   * called by `main.ts` before deciding whether to show the unlock form at all, and before
   * `load()` runs (a locked device must not attempt to decrypt anything before the operator
   * has typed a passphrase). Never throws: a marker this session cannot read is treated the
   * same as no marker, so a corrupted marker record can never itself stop the app booting -
   * see `main.ts`'s own comment on why nothing here is allowed to brick the app.
   */
  async checkEncryption(): Promise<boolean> {
    await this.ensureDb()
    if (!this.dbAvailable) { this.marker = undefined; return false }
    try {
      const raw = await this.idbGet(ENCRYPTION_MARKER_KEY)
      if (raw === null) { this.marker = undefined; return false }
      const parsed = JSON.parse(raw)
      if (!isEncryptionMarker(parsed)) {
        console.warn('RecordStore: the encryption marker record is not in a recognized shape; treating this device as unencrypted.')
        this.marker = undefined
        return false
      }
      this.marker = parsed
      return true
    } catch (e: any) {
      console.warn(`RecordStore: could not read the encryption marker (${e?.message ?? e}); treating this device as unencrypted.`)
      this.marker = undefined
      return false
    }
  }

  /** True once `checkEncryption()` has found a marker - independent of whether unlocked yet. */
  isEncryptionEnabled(): boolean { return !!this.marker }

  /** The session's derived key, or undefined if never unlocked (or encryption is off). */
  getEncryptionKey(): CryptoKey | undefined { return this.key }

  /**
   * Derives a key from `passphrase` against the cached marker and checks it via the verifier.
   * Never throws, never mutates state - `unlock()` below is the state-changing counterpart
   * used at boot; this is also reused by the Disable flow (mission-advanced-options.component.ts),
   * which needs the same verified key to hand to `RangerPhotoService` without unlock()'s
   * side effect of arming `this.key` for a device that is about to stop being encrypted.
   */
  async verifyPassphrase(passphrase: string): Promise<CryptoKey | null> {
    if (!this.marker) return null
    return unlockWithPassphrase(this.marker, passphrase)
  }

  /**
   * Called from the plain-DOM unlock form (`shared/storage/unlock-form.ts`) before `load()`.
   * On a correct passphrase, arms `this.key` so `load()`'s decryption and every subsequent
   * `drain()`'s encryption have a key to use, and returns true. On a wrong passphrase, leaves
   * state untouched and returns false - the form re-prompts, with no retry lockout.
   */
  async unlock(passphrase: string): Promise<boolean> {
    const key = await this.verifyPassphrase(passphrase)
    if (!key) return false
    this.key = key
    return true
  }

  /**
   * Mission > Data safety's "Enable" action. Requires the caller (the component) to have
   * already gated this on a fresh backup and a twice-typed passphrase - this method only
   * does the storage work: write a fresh marker, arm the key, and re-encrypt every
   * `ENCRYPTED_KEYS` record already in the Map in place.
   *
   * E-122 Phase 2b follow-up: the marker is persisted FIRST, on its own, awaited directly
   * rather than routed through `queueWrite()`/`drain()` - `drain()` only logs a failed write
   * and moves on, which is fine for an ordinary key but not for the one record every future
   * unlock depends on. Nothing has been encrypted yet at this point, so a failed marker write
   * is fully recoverable: `this.marker`/`this.key` are never assigned, and this throws instead
   * of leaving the caller to report success. Only once the marker is safely down does this
   * requeue the `ENCRYPTED_KEYS` records through the normal pipeline and await them with
   * `flushReportingFailures()` (rather than plain `flush()`) so a failed record write also
   * throws instead of being silently swallowed - the marker being present already means
   * `load()` still works either way (it decides per record via `isEncryptedEnvelope()`), but
   * the caller must not be told this finished cleanly when it didn't.
   */
  async enableEncryption(passphrase: string): Promise<void> {
    if (this.marker) throw new Error('Encryption is already enabled on this device.')
    const { marker, key } = await createEncryptionMarker(passphrase)

    await this.ensureDb()
    try {
      if (this.dbAvailable) await this.idbPut(ENCRYPTION_MARKER_KEY, JSON.stringify(marker))
      else localStorage.setItem(ENCRYPTION_MARKER_KEY, JSON.stringify(marker))
    } catch (e: any) {
      throw new Error(`the new passphrase could not be saved; nothing was changed (${e?.message ?? e}).`)
    }
    this.marker = marker
    this.key = key

    for (const k of ENCRYPTED_KEYS) {
      if (this.map.has(k)) this.setItem(k, this.map.get(k)!)
    }
    const failures = await this.flushReportingFailures()
    if (failures.size) {
      throw new Error(`encryption is on, but ${[...failures].join(', ')} could not be `
        + `re-encrypted yet; try Enable again to finish.`)
    }
  }

  /**
   * Mission > Data safety's "Disable" action. The caller has already verified the typed
   * passphrase via `verifyPassphrase()` (so it can hand the same key to
   * `RangerPhotoService.decryptAll()` first) - this method clears the key/marker BEFORE
   * requeueing the ENCRYPTED_KEYS writes, so `drain()` (which decides whether to encrypt by
   * checking `this.key` at the moment it actually runs, not when queued) writes them out in
   * the clear. The in-memory Map was never anything but plaintext, so there is nothing to
   * decrypt here - only a marker to delete and every record to re-persist unencrypted.
   *
   * E-122 Phase 2b follow-up: `flushReportingFailures()` (not plain `flush()`) is awaited for
   * the record rewrites, and their local copies of the marker/key are kept so a failed write
   * can be rolled back - drain()'s own log-and-continue used to let this resolve
   * "successfully" while a record stayed encrypted with no marker left to unlock it. If any
   * record fails, the marker/key are restored (encryption is, and must keep reporting as,
   * still ON) and this throws. Only once every record has actually committed plaintext does
   * the marker itself get deleted - a failure at THAT point is harmless (see below) but still
   * thrown, so the caller never reports unconditional success.
   */
  async disableEncryption(): Promise<void> {
    if (!this.marker) throw new Error('Encryption is not enabled on this device.')
    const marker = this.marker
    const key = this.key
    this.marker = undefined
    this.key = undefined

    // Records first, marker LAST: if the marker delete below fails or never runs, the next
    // boot still asks for the passphrase and decrypts whatever is left encrypted. The other
    // order could strand encrypted records with no marker - no unlock prompt, no key, and the
    // data unreadable for good.
    for (const k of ENCRYPTED_KEYS) {
      if (this.map.has(k)) this.setItem(k, this.map.get(k)!)
    }
    const failures = await this.flushReportingFailures()
    if (failures.size) {
      // Some records are still encrypted with no way to rewrite them differently right now -
      // restoring the marker/key means the device keeps describing reality (still encrypted)
      // rather than silently becoming impossible to unlock.
      this.marker = marker
      this.key = key
      throw new Error(`some data could not be rewritten unencrypted (${[...failures].join(', ')}); `
        + `your data is still protected. Try again.`)
    }

    try {
      if (this.dbAvailable) await this.idbDelete(ENCRYPTION_MARKER_KEY)
      else localStorage.removeItem(ENCRYPTION_MARKER_KEY)
    } catch (e: any) {
      // Every record already committed in the clear - only the marker itself is stuck. Next
      // boot still asks for the (now-irrelevant) passphrase, unlock() still succeeds against
      // it, and load() finds every record already plaintext (isEncryptedEnvelope() sees no
      // envelope) and returns it as-is. Thrown anyway so the caller doesn't report success.
      throw new Error(`the marker could not be removed, but your data is already unencrypted `
        + `and safe; you may be asked for the passphrase once more (${e?.message ?? e}).`)
    }
  }

  /**
   * The lock screen's "Forgot it" flow (`unlock-form.ts`), run before Angular boots: deletes
   * the encrypted records and the marker so a lost-forever passphrase cannot permanently brick
   * the device - the user restores from a backup afterward (Mission > Danger zone). Deliberately
   * narrow: `locations` and every `localStorage`-only key were never encrypted and are left
   * alone, since a forgotten roster/report passphrase is no reason to also discard those.
   * Ranger photos live in a separate database and are erased by the caller directly - this
   * store has no reference to `RangerPhotoService`.
   */
  async eraseEncryptedRecords(): Promise<void> {
    await this.ensureDb()
    this.marker = undefined
    this.key = undefined
    for (const key of [...ENCRYPTED_KEYS, ENCRYPTION_MARKER_KEY]) {
      this.map.delete(key)
      if (this.dbAvailable) {
        try {
          await this.idbDelete(key)
        } catch (e: any) {
          console.error(`RecordStore: could not erase "${key}" (${e?.message ?? e}).`)
        }
      } else {
        localStorage.removeItem(key)
      }
    }
  }

  /**
   * Encrypts `plaintext` for `key` if (and only if) encryption is armed this session AND
   * `key` is one of `ENCRYPTED_KEYS` - every other key (locations, the marker itself) passes
   * through untouched. Shared by `drain()` and `migrateOne()` so both write paths agree.
   */
  private async encryptIfNeeded(key: string, plaintext: string): Promise<string> {
    if (!this.key || !(ENCRYPTED_KEYS as readonly string[]).includes(key)) return plaintext
    return JSON.stringify(await encryptRecordValue(this.key, plaintext))
  }

  /**
   * Reverses encryptIfNeeded() for a value just read from IndexedDB. A record that isn't
   * shaped like one of this app's own envelopes (isEncryptedEnvelope()) is assumed already
   * plaintext and returned as-is - this covers both a device that never encrypted anything and
   * `locations`/other non-`ENCRYPTED_KEYS` values, without needing to ask the marker first.
   * Returns null - "treat this key as missing" - for an envelope this session cannot open
   * (no key yet, wrong key, or corruption): logged, but never thrown, so one bad record can
   * never stop the rest of the store (or the app) from loading. See main.ts's own comment on
   * why nothing in this boot path is allowed to brick the app.
   */
  private async decryptIfNeeded(key: string, raw: string): Promise<string | null> {
    if (!(ENCRYPTED_KEYS as readonly string[]).includes(key)) return raw
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Not JSON at all - can't be one of our envelopes either. Treat as already plaintext
      // (matches this store's existing tolerance for whatever a caller's setItem() wrote).
      return raw
    }
    if (!isEncryptedEnvelope(parsed)) return raw
    if (!this.key) {
      console.error(`RecordStore: "${key}" is encrypted but this session has no key; treating it as missing.`)
      return null
    }
    try {
      return await decryptRecordValue(this.key, parsed)
    } catch (e: any) {
      console.error(`RecordStore: could not decrypt "${key}" (${e?.message ?? e}); treating it as missing.`)
      return null
    }
  }

  /** Resolves once `getItem()` is safe to trust for `MIGRATED_KEYS` - awaited by `main.ts`. */
  async load(): Promise<void> {
    await this.ensureDb()

    for (const key of MIGRATED_KEYS) {
      if (!this.dbAvailable) {
        // No IndexedDB this session (private mode, etc.) - localStorage IS the store for the
        // rest of this session. Nothing to migrate; nowhere to migrate it TO.
        const fallback = localStorage.getItem(key)
        if (fallback !== null) this.map.set(key, fallback)
        continue
      }

      let value: string | null
      try {
        value = await this.idbGet(key)
      } catch (e: any) {
        console.warn(`RecordStore: could not read "${key}" from IndexedDB `
          + `(${e?.message ?? e}); using localStorage for this key this session.`)
        const fallback = localStorage.getItem(key)
        if (fallback !== null) this.map.set(key, fallback)
        continue
      }

      // E-122 Phase 2b: only a value that actually came from IndexedDB can be one of this
      // app's own encrypted envelopes - the legacy-localStorage and fallback paths below are
      // always plaintext (2a shipped months before 2b existed) and are deliberately left out
      // of this call, see decryptIfNeeded()'s own comment.
      if (value !== null) {
        value = await this.decryptIfNeeded(key, value)
      }

      if (value === null) {
        const legacy = localStorage.getItem(key)
        if (legacy !== null) {
          value = await this.migrateOne(key, legacy)
        }
      } else if (localStorage.getItem(key) !== null) {
        // IndexedDB already holds this key, so it is the live copy (every write since goes
        // there), yet a plaintext localStorage copy survived - left behind by a migration
        // whose read-back check failed on an earlier load. Retire it now rather than never.
        localStorage.removeItem(key)
        console.info(`RecordStore: removed a stale localStorage copy of "${key}".`)
      }
      // E-122 Phase 2b: the explicit delete() (not just "skip the set()") matters if load()
      // ever runs again against a Map that already holds an earlier value for this key - an
      // undecryptable record must actually WIN over stale in-memory state, not be silently
      // shadowed by it. Normal boot never hits this (main.ts calls load() once, against an
      // empty Map), but "treated as missing" has to mean missing, not "whatever was already
      // there."
      if (value !== null) this.map.set(key, value)
      else this.map.delete(key)
    }
  }

  /**
   * One-time move of a single key from `localStorage` into IndexedDB (E-122 Phase 2a item 4):
   * write, read the write back, compare, and only THEN remove the `localStorage` copy - a
   * returning user's plaintext PII must never end up written nowhere at all. Returns the
   * value `load()` should put in the in-memory Map for the rest of this session: the migrated
   * value on success, or the original `localStorage` value (with `localStorage` left
   * untouched, so migration is simply retried on the next `load()`) if anything about the
   * write/read-back went wrong.
   */
  private async migrateOne(key: string, legacyValue: string): Promise<string> {
    try {
      // E-122 Phase 2b: encrypted the same way drain() would, so a device that enabled
      // encryption before every key had finished migrating (only plausible for a returning
      // user restoring very old localStorage state) never writes this PII to IndexedDB in
      // the clear. The read-back below compares against the STORED form, not legacyValue -
      // it is verifying the write actually round-trips, not re-deriving plaintext.
      const stored = await this.encryptIfNeeded(key, legacyValue)
      await this.idbPut(key, stored)
      const readBack = await this.idbGet(key)
      if (readBack !== stored) {
        console.warn(`RecordStore: migrating "${key}" to IndexedDB read back different `
          + `content than was written; leaving localStorage untouched and will retry next load.`)
        return legacyValue
      }
      localStorage.removeItem(key)
      console.info(`RecordStore: migrated "${key}" from localStorage to IndexedDB.`)
      return legacyValue
    } catch (e: any) {
      console.warn(`RecordStore: migrating "${key}" to IndexedDB failed `
        + `(${e?.message ?? e}); leaving localStorage untouched and will retry next load.`)
      return legacyValue
    }
  }

  /** Synchronous, mirroring `localStorage.getItem()` - null when the key has no value. */
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  /** Synchronous to the caller: the Map updates at once, IndexedDB catches up shortly after. */
  setItem(key: string, value: string): void {
    this.map.set(key, value)
    this.queueWrite(key, value)
  }

  /** Synchronous to the caller, same as `setItem()`. */
  removeItem(key: string): void {
    this.map.delete(key)
    this.queueWrite(key, null)
  }

  private queueWrite(key: string, value: string | null): void {
    if (!this.dbAvailable) {
      // Fallback session: there is no async IndexedDB write to coalesce - localStorage IS
      // the store, so the write happens synchronously, right here.
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
      return
    }
    this.pending.set(key, value)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return
    this.flushQueued = true
    // A microtask, not a timer: this coalesces every setItem()/removeItem() for the same key
    // made synchronously (or across further microtasks) before this callback runs - only the
    // LAST pending value per key is ever written to IndexedDB - while still running as soon
    // as the current synchronous work is done, so flush() (pagehide, tests) never has to wait
    // out a real timer.
    queueMicrotask(() => {
      this.flushQueued = false
      this.writeChain = this.writeChain.then(() => this.drain())
    })
  }

  /**
   * `failures`, when given, collects the key of every write that fails in this pass, in
   * addition to (not instead of) the usual `console.error()` - used only by
   * `flushReportingFailures()` (enable/disable's own flush) so they can fail loudly. An
   * ordinary `setItem()`/`removeItem()` caller goes through the microtask-scheduled call below
   * with no `failures` set, and keeps today's log-and-continue behaviour unchanged.
   */
  private async drain(failures?: Set<string>): Promise<void> {
    const entries = [...this.pending.entries()]
    this.pending.clear()
    if (!entries.length) return

    // Lazily opens the database on the FIRST write, same as a read would via load(). Most
    // callers (the real app) always call load() before anything writes, but nothing here
    // actually requires that ordering - a setItem() with no prior load() (every unit test in
    // record-store.spec.ts, characterization specs that seed a key before constructing a
    // service) must still work. ensureDb() caches its result, so this is a no-op once load()
    // (or an earlier drain()) has already run it.
    await this.ensureDb()

    if (!this.dbAvailable) {
      // Became unavailable between queueing and draining - never lose a write over it. Still
      // encrypted if armed: this device may have enabled encryption in an earlier session
      // (the marker is already in IndexedDB) and only lost IndexedDB access just now - a
      // transient failure must not be the reason plaintext PII lands in localStorage.
      for (const [key, value] of entries) {
        try {
          if (value === null) { localStorage.removeItem(key); continue }
          localStorage.setItem(key, await this.encryptIfNeeded(key, value))
        } catch (e: any) {
          console.error(`RecordStore: failed to persist "${key}" to localStorage: ${e?.message ?? e}`)
          failures?.add(key)
        }
      }
      return
    }

    for (const [key, value] of entries) {
      try {
        if (value === null) { await this.idbDelete(key); continue }
        await this.idbPut(key, await this.encryptIfNeeded(key, value))
      } catch (e: any) {
        console.error(`RecordStore: failed to persist "${key}" to IndexedDB: ${e?.message ?? e}`)
        failures?.add(key)
      }
    }
  }

  /**
   * Awaitable flush: forces any scheduled-but-not-yet-run write pass to run now, and resolves
   * once every write queued up to this call has committed (or failed and been logged). Used
   * by `pagehide`/`visibilitychange:hidden` below, and by tests that need a synchronization
   * point rather than a real wait.
   */
  async flush(): Promise<void> {
    if (this.flushQueued) {
      this.flushQueued = false
      this.writeChain = this.writeChain.then(() => this.drain())
    }
    await this.writeChain
  }

  /**
   * Like `flush()`, but returns the set of keys whose write failed during this pass instead of
   * only logging them - used solely by `enableEncryption()`/`disableEncryption()`, which must
   * fail loudly rather than report success while a record silently failed to (re)write. Safe to
   * call right after synchronously queueing writes (as both of those do): `queueWrite()` always
   * runs `scheduleFlush()` first, so `flushQueued` is already true and the drain pass this
   * triggers is the one that will actually process them - nothing else runs in between in this
   * single-threaded flow to smuggle in unrelated pending entries.
   */
  private async flushReportingFailures(): Promise<Set<string>> {
    const failures = new Set<string>()
    if (this.flushQueued) {
      this.flushQueued = false
      this.writeChain = this.writeChain.then(() => this.drain(failures))
    }
    await this.writeChain
    return failures
  }

  /**
   * Test-only: clears every trace of state (in-memory Map, queued writes, and the underlying
   * IndexedDB database itself) so specs get a clean slate between `it()`s without a real page
   * reload - the equivalent of the `localStorage.clear()` these three services' specs already
   * did before E-122 Phase 2a. Never called from application code.
   */
  async resetForTests(): Promise<void> {
    await this.flush()
    this.map.clear()
    this.pending.clear()
    this.flushQueued = false
    this.writeChain = Promise.resolve()
    this.dbAvailable = true
    this.openPromise = undefined
    this.marker = undefined
    this.key = undefined
    // close() lets any transaction already in flight finish; it does not abort one.
    this.db?.close()
    this.db = undefined
    if (typeof indexedDB === 'undefined') return
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  }

  // ── IndexedDB internals ──────────────────────────────────────────────────

  private ensureDb(): Promise<void> {
    if (this.openPromise) return this.openPromise
    this.openPromise = new Promise<void>(resolve => {
      if (typeof indexedDB === 'undefined') {
        this.dbAvailable = false
        console.warn('RecordStore: IndexedDB is unavailable in this browser/mode; '
          + 'falling back to localStorage for this session.')
        resolve()
        return
      }
      this.openDb(undefined, resolve)
    })
    return this.openPromise
  }

  /**
   * Opens the database and makes sure the object store exists. If something else created
   * `rangertrak-records` first without our store - an empty database at our version means no
   * `upgradeneeded` ever fires for us, and every read and write would then fail - reopen one
   * version higher so the upgrade runs and creates it. Without this, that state would lose
   * every write for good, with only a console error to show for it.
   */
  private openDb(version: number | undefined, done: () => void): void {
    // No version pin on a normal open: it opens whatever version exists (creating v1 fresh),
    // so a database the repair below has bumped still opens instead of failing a VersionError.
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.close()
        this.openDb(db.version + 1, done)
        return
      }
      // Another tab repairing the database (above) must not be blocked by this one: let go,
      // and the next read or write reopens it through ensureDb().
      db.onversionchange = () => { db.close(); this.db = undefined; this.openPromise = undefined }
      this.db = db
      done()
    }
    req.onerror = () => {
      this.dbAvailable = false
      console.warn(`RecordStore: could not open IndexedDB (${req.error?.message ?? req.error}); `
        + `falling back to localStorage for this session.`)
      done()
    }
  }

  /**
   * Resolves on `transaction.oncomplete`, not `req.onsuccess` - the request event fires once
   * the individual read/write is queued and answered, which for a `readwrite` transaction is
   * BEFORE the browser has actually committed it. Same reasoning, same pattern, as
   * `ranger-photo.service.ts`'s own `tx()` helper.
   */
  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('record store not open')); return }
      const transaction = this.db.transaction(STORE, mode)
      const req = fn(transaction.objectStore(STORE))
      let result: T
      req.onsuccess = () => { result = req.result }
      req.onerror = () => reject(req.error)
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(transaction.error ?? req.error ?? new Error('record store transaction aborted'))
      transaction.onerror = () => reject(transaction.error ?? req.error ?? new Error('record store transaction error'))
    })
  }

  private async idbGet(key: string): Promise<string | null> {
    const value = await this.tx<string | undefined>('readonly', s => s.get(key))
    return value ?? null
  }

  private idbPut(key: string, value: string): Promise<void> {
    return this.tx('readwrite', s => s.put(value, key)).then(() => undefined)
  }

  private idbDelete(key: string): Promise<void> {
    return this.tx('readwrite', s => s.delete(key)).then(() => undefined)
  }
}

/**
 * The one real instance. Import this directly from `main.ts` (before Angular boots) and from
 * the domain services that own a personal-data key (`RangerService`, `RadioLogService`,
 * `MissionLocationService`) - the same "direct import, not the barrel" idiom those services
 * already use for each other. See this file's header comment for why a singleton rather than
 * purely an `@Injectable`.
 */
export const recordStore = new RecordStoreImpl()

/**
 * Angular-DI-friendly wrapper around the exact same `recordStore` singleton above, for any
 * Angular code that would rather inject it than import the singleton directly (a component,
 * or a test that wants to `TestBed.overrideProvider` it). Everything it forwards to shares one
 * real Map with `recordStore` and with whatever `main.ts` already loaded before bootstrap -
 * there are not two stores, just two ways to reach one.
 */
@Injectable({ providedIn: 'root' })
export class RecordStore {
  getItem(key: string): string | null { return recordStore.getItem(key) }
  setItem(key: string, value: string): void { recordStore.setItem(key, value) }
  removeItem(key: string): void { recordStore.removeItem(key) }
  load(): Promise<void> { return recordStore.load() }
  flush(): Promise<void> { return recordStore.flush() }

  // E-122 Phase 2b: Mission > Data safety (mission-advanced-options.component.ts) is the one
  // Angular consumer of the encryption surface, so it reaches it through this DI wrapper
  // rather than importing the singleton directly - `main.ts`'s own unlock flow, which runs
  // before Angular exists, still imports `recordStore` directly (see unlock-form.ts).
  isEncryptionEnabled(): boolean { return recordStore.isEncryptionEnabled() }
  getEncryptionKey(): CryptoKey | undefined { return recordStore.getEncryptionKey() }
  verifyPassphrase(passphrase: string): Promise<CryptoKey | null> { return recordStore.verifyPassphrase(passphrase) }
  enableEncryption(passphrase: string): Promise<void> { return recordStore.enableEncryption(passphrase) }
  disableEncryption(): Promise<void> { return recordStore.disableEncryption() }
}

// Best-effort persistence on the way out. `pagehide` fires on tab close/navigation-away and
// (unlike `beforeunload`) reliably fires on mobile/PWA backgrounding too; `visibilitychange`
// to `hidden` catches the app being backgrounded without being torn down (switching apps on a
// tablet, screen lock) - the case `pagehide` alone would miss. Neither can truly guarantee an
// async IndexedDB write commits before the process dies, but both fire early enough in
// practice that this is the best a browser offers; `flush()` itself is what actually runs the
// write, this only decides when to call it.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') recordStore.flush().catch(() => { })
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { recordStore.flush().catch(() => { }) })
}
