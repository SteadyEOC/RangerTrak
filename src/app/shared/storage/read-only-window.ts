/**
 * E-313 / ADR D-71: a read-only window (`?display=1&popout=1`): a pop-out, or the blocked-tab gate's
 * "Open a read-only view here". It takes no tab lock, so it can sit beside the main window, and in
 * exchange it must never write anything. The main window stays the only one that writes.
 *
 * Skipping the lock is not enough: a booting app writes on its own, with nobody touching it (see the
 * survey table in the E-313 brief: each service persists what it just read, the settings are stamped
 * on every boot, the update check keeps a clock). So the guard sits at the storage layer and goes in
 * FIRST, before anything touches storage, in main.ts. Services that know they would write also check
 * `isReadOnlyWindow()` and skip it; this guard is the safety net for a write nobody thought of, and
 * it says so in the console (`read-only window: blocked write ...`) so the e2e check can tell.
 *
 * Nothing about a read-only window is stored (D-71): the flag is a module variable, set from the URL.
 */

/** The URL parameter that makes a window read-only: `?popout=1` (always with `display=1`). */
export const POPOUT_PARAM = 'popout'

/** The `<html>` attribute the read-only frame and label key off (styles/_display.scss). */
export const READ_ONLY_ATTRIBUTE = 'data-readonly'

let readOnly = false
const restorers: Array<() => void> = []

/** True in a read-only window. False until `installReadOnlyGuard()` has run. */
export function isReadOnlyWindow(): boolean {
  return readOnly
}

/** Whether the address asks for a read-only window. */
export function wantsReadOnlyWindow(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get(POPOUT_PARAM) === '1'
}

/** What a blocked IndexedDB write throws. Callers already catch IndexedDB failures. */
function readOnlyError(): DOMException {
  return new DOMException('ReadOnlyWindow', 'ReadOnlyError')
}

function warnBlocked(what: unknown): void {
  console.warn(`read-only window: blocked write ${String(what)}`)
}

/** Replaces `target[name]` and remembers how to put it back (tests only). */
function replace(target: object | undefined, name: string, fake: (...args: unknown[]) => unknown): void {
  if (!target) return
  const holder = target as Record<string, unknown>
  const original = holder[name]
  if (typeof original !== 'function') return
  holder[name] = fake
  restorers.push(() => { holder[name] = original })
}

/**
 * Turns this window read-only, for good (until the page is closed). One list, here, of every platform
 * write there is, and why each is in it:
 *
 * - `Storage` (localStorage and sessionStorage): setItem, removeItem, clear. The settings, the theme,
 *   the update clock and a dozen small flags live here. Does nothing, with a warning.
 * - `IDBObjectStore`: put, add, delete, clear, createIndex, deleteIndex. The roster, radio log,
 *   places, notes, photos and attachments. Throws `ReadOnlyError`.
 * - `IDBCursor`: update and delete write through a cursor. Throws.
 * - `IDBDatabase`: createObjectStore and deleteObjectStore. A first-time open would create the store.
 *   Throws, which aborts the upgrade, so nothing is created.
 * - `IDBFactory`: deleteDatabase. "Erase this device" and the test helpers use it. Throws.
 * - `Cache` (Cache Storage): put, add, addAll, delete. Map tiles and offline map files. Resolves
 *   without writing: a tile cache is not mission data, but "never writes" is simpler to prove than
 *   "never writes mission data".
 * - `CacheStorage.delete`: dropping a whole cache. Resolves false.
 *
 * `localStorage.foo = 'x'` (a property assignment rather than setItem) cannot be intercepted this
 * way; no code in this app does it, and the e2e check compares the stored data itself as well.
 */
export function installReadOnlyGuard(): void {
  if (readOnly) return
  readOnly = true
  document.documentElement.setAttribute(READ_ONLY_ATTRIBUTE, '')

  const storageWrite = (name: string) => function (this: Storage, key?: unknown) {
    warnBlocked(name === 'clear' ? '(clear)' : key)
  }
  for (const name of ['setItem', 'removeItem', 'clear']) replace(Storage.prototype, name, storageWrite(name))

  const idbThrows = (what: string) => function (this: unknown, ...args: unknown[]): never {
    warnBlocked(`${what} ${String(args[1] ?? args[0] ?? '')}`.trim())
    throw readOnlyError()
  }
  if (typeof IDBObjectStore !== 'undefined') {
    for (const name of ['put', 'add', 'delete', 'clear', 'createIndex', 'deleteIndex']) {
      replace(IDBObjectStore.prototype, name, idbThrows(`IDBObjectStore.${name}`))
    }
  }
  if (typeof IDBCursor !== 'undefined') {
    for (const name of ['update', 'delete']) replace(IDBCursor.prototype, name, idbThrows(`IDBCursor.${name}`))
  }
  if (typeof IDBDatabase !== 'undefined') {
    for (const name of ['createObjectStore', 'deleteObjectStore']) {
      replace(IDBDatabase.prototype, name, idbThrows(`IDBDatabase.${name}`))
    }
  }
  if (typeof IDBFactory !== 'undefined') replace(IDBFactory.prototype, 'deleteDatabase', idbThrows('IDBFactory.deleteDatabase'))

  if (typeof Cache !== 'undefined') {
    for (const name of ['put', 'add', 'addAll']) {
      replace(Cache.prototype, name, function (this: Cache, ...args: unknown[]) {
        const target = args[0]
        warnBlocked(`Cache.${name} ${typeof target === 'string' ? target : ((target as Request | undefined)?.url ?? '')}`.trim())
        return Promise.resolve()
      })
    }
    replace(Cache.prototype, 'delete', function () { warnBlocked('Cache.delete'); return Promise.resolve(false) })
  }
  if (typeof CacheStorage !== 'undefined') {
    replace(CacheStorage.prototype, 'delete', function () { warnBlocked('CacheStorage.delete'); return Promise.resolve(false) })
  }
}

/** Test only: puts every prototype back and clears the flag, so one spec's guard does not leak into the next. */
export function resetReadOnlyGuardForTests(): void {
  while (restorers.length) restorers.pop()!()
  readOnly = false
  if (typeof document !== 'undefined') document.documentElement.removeAttribute(READ_ONLY_ATTRIBUTE)
}
