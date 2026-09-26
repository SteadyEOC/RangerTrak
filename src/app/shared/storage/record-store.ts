import { Injectable } from '@angular/core'

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
 * PHASE 2b, NOT YET BUILT
 * -------------------------
 * Per-record AES-GCM encryption (opt-in, unlocked by a plain-DOM passphrase form in `main.ts`
 * before Angular boots) lands on top of this store later. Nothing here encrypts anything yet;
 * every value is stored exactly as the calling service's own `JSON.stringify()` produced it.
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
      if (value !== null) this.map.set(key, value)
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
      await this.idbPut(key, legacyValue)
      const readBack = await this.idbGet(key)
      if (readBack !== legacyValue) {
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

  private async drain(): Promise<void> {
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
      // Became unavailable between queueing and draining - never lose a write over it.
      for (const [key, value] of entries) {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      }
      return
    }

    for (const [key, value] of entries) {
      try {
        if (value === null) await this.idbDelete(key)
        else await this.idbPut(key, value)
      } catch (e: any) {
        console.error(`RecordStore: failed to persist "${key}" to IndexedDB: ${e?.message ?? e}`)
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
