import { DB_NAME, recordStore, STORE } from './record-store'
import { installReadOnlyGuard, isReadOnlyWindow, READ_ONLY_ATTRIBUTE, resetReadOnlyGuardForTests, wantsReadOnlyWindow } from './read-only-window'

/**
 * E-313 / D-71: the storage-layer guard of a read-only window. Every prototype it covers is blocked,
 * says so in the console, and goes back to normal when the spec ends (the guard is process-wide).
 */
describe('read-only window guard (E-313)', () => {
  afterEach(() => {
    resetReadOnlyGuardForTests()
    localStorage.removeItem('guard-spec')
    vi.restoreAllMocks()
  })

  it('is off until installed, and says so', () => {
    expect(isReadOnlyWindow()).toBe(false)
    installReadOnlyGuard()
    expect(isReadOnlyWindow()).toBe(true)
    expect(document.documentElement.hasAttribute(READ_ONLY_ATTRIBUTE)).toBe(true)
    resetReadOnlyGuardForTests()
    expect(isReadOnlyWindow()).toBe(false)
    expect(document.documentElement.hasAttribute(READ_ONLY_ATTRIBUTE)).toBe(false)
  })

  it('reads ?popout=1 from the address', () => {
    expect(wantsReadOnlyWindow('?display=1&popout=1')).toBe(true)
    expect(wantsReadOnlyWindow('?display=1')).toBe(false)
    expect(wantsReadOnlyWindow('?popout=0')).toBe(false)
    expect(wantsReadOnlyWindow('')).toBe(false)
  })

  it('blocks localStorage and sessionStorage writes, with a warning naming the key', () => {
    localStorage.setItem('guard-spec', 'before')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installReadOnlyGuard()

    localStorage.setItem('guard-spec', 'after')
    localStorage.removeItem('guard-spec')
    sessionStorage.setItem('guard-spec', 'x')
    localStorage.clear()

    expect(localStorage.getItem('guard-spec')).toBe('before')
    expect(sessionStorage.getItem('guard-spec')).toBeNull()
    const said = warn.mock.calls.map(c => String(c[0]))
    expect(said).toContain('read-only window: blocked write guard-spec')
    expect(said.length).toBe(4)
  })

  it('throws ReadOnlyError for every IndexedDB write, and still reads', async () => {
    await recordStore.resetForTests()
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onsuccess = () => { open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installReadOnlyGuard()

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const names: Array<() => unknown> = [
      () => store.put('v', 'k'), () => store.add('v', 'k'), () => store.delete('k'), () => store.clear(),
      () => store.createIndex('i', 'x'), () => store.deleteIndex('i'),
      () => db.createObjectStore('other'), () => db.deleteObjectStore(STORE),
      () => indexedDB.deleteDatabase(DB_NAME),
    ]
    for (const write of names) {
      expect(write).toThrowError(expect.objectContaining({ name: 'ReadOnlyError' }))
    }
    // a read still works
    const value = await new Promise(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('k')
      req.onsuccess = () => resolve(req.result)
    })
    expect(value).toBeUndefined()
    db.close()
  })

  it('lets a database that does not exist yet create its empty stores, but no records (11-16 bug)', async () => {
    const name = 'rt-readonly-fresh-' + Math.random().toString(36).slice(2)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installReadOnlyGuard()
    let putError: unknown
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('kv')
        store.createIndex('byX', 'x')
        try { store.put('v', 'k') } catch (e) { putError = e }
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    expect(putError).toEqual(expect.objectContaining({ name: 'ReadOnlyError' }))
    expect([...db.objectStoreNames]).toEqual(['kv'])
    const count = await new Promise(resolve => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').count()
      req.onsuccess = () => resolve(req.result)
    })
    expect(count).toBe(0)
    db.close()
    resetReadOnlyGuardForTests()
    await new Promise(resolve => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = resolve })
  })

  it('still refuses to upgrade a database that already exists', async () => {
    const name = 'rt-readonly-old-' + Math.random().toString(36).slice(2)
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => open.result.createObjectStore('a')
      open.onsuccess = () => { open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installReadOnlyGuard()
    const outcome = await new Promise<string>(resolve => {
      const open = indexedDB.open(name, 2)
      open.onupgradeneeded = () => { try { open.result.createObjectStore('b'); resolve('created') } catch { resolve('blocked') } }
      open.onsuccess = () => { open.result.close() }
      open.onerror = () => undefined
    })
    expect(outcome).toBe('blocked')
    resetReadOnlyGuardForTests()
    await new Promise(resolve => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = d.onblocked = resolve })
  })

  it('makes Cache Storage writes do nothing', async () => {
    const name = 'read-only-guard-spec'
    const cache = await caches.open(name)
    await cache.put('/guard-spec-before', new Response('before'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installReadOnlyGuard()

    await cache.put('/guard-spec-after', new Response('after'))
    await cache.add('/guard-spec-added').catch(() => undefined)
    expect(await cache.delete('/guard-spec-before')).toBe(false)
    expect(await caches.delete(name)).toBe(false)

    expect((await cache.keys()).map(r => new URL(r.url).pathname)).toEqual(['/guard-spec-before'])
    resetReadOnlyGuardForTests()
    await caches.delete(name)
  })

  it('installing twice is harmless', () => {
    installReadOnlyGuard()
    installReadOnlyGuard()
    resetReadOnlyGuardForTests()
    localStorage.setItem('guard-spec', 'works again')
    expect(localStorage.getItem('guard-spec')).toBe('works again')
  })
})
