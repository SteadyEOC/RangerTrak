import { DB_NAME, recordStore, STORE } from './record-store'

/**
 * E-313 step 1, the survey test for the storage path. A pop-out (read-only window) boots with
 * `recordStore.load({ readOnly: true })`; whatever that does must never write anywhere: not
 * localStorage, not IndexedDB, not Cache Storage. Spies sit on the three platform prototypes, so
 * a write added later by anyone, in any form, turns this red.
 *
 * The device here is deliberately in the state that makes a normal load() write: a key that
 * exists only in the legacy localStorage place (a normal load migrates it into IndexedDB and
 * deletes the old copy) and a key that exists in both (a normal load deletes the stale copy).
 */
describe('RecordStore.load({ readOnly: true }) (E-313)', () => {
  function putRaw(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }

  /** A device in the state that makes a normal load() write; recordStore starts empty (resetForTests). */
  async function seed(): Promise<void> {
    await putRaw('rangers', '{"rangers":["from-idb"]}')
    localStorage.setItem('rangers', '{"rangers":["stale-copy"]}') // in both places
    localStorage.setItem('radioLog', '{"logEntries":["legacy-only"]}') // legacy only
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('writes nothing, deletes nothing, and still serves both values from memory', async () => {
    await seed()

    const writes: string[] = []
    const note = (what: string) => function (this: unknown, ...a: unknown[]) { writes.push(`${what} ${String(a[0])}`) }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(note('localStorage.setItem'))
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(note('localStorage.removeItem'))
    vi.spyOn(Storage.prototype, 'clear').mockImplementation(note('localStorage.clear'))
    for (const m of ['put', 'add', 'delete', 'clear'] as const) {
      vi.spyOn(IDBObjectStore.prototype, m).mockImplementation(function (this: IDBObjectStore) {
        writes.push(`IDBObjectStore.${m}`)
        throw new DOMException('spy', 'ReadOnlyError')
      } as never)
    }
    for (const m of ['put', 'add', 'addAll', 'delete'] as const) {
      vi.spyOn(Cache.prototype, m).mockImplementation((() => { writes.push(`Cache.${m}`); return Promise.resolve() }) as never)
    }

    await recordStore.load({ readOnly: true })

    expect(writes).toEqual([])
    expect(recordStore.getItem('rangers')).toBe('{"rangers":["from-idb"]}')
    expect(recordStore.getItem('radioLog')).toBe('{"logEntries":["legacy-only"]}') // the legacy value, in memory
  })

  it('keeps the legacy localStorage copies where they were', async () => {
    await seed()

    await recordStore.load({ readOnly: true })

    expect(localStorage.getItem('rangers')).toBe('{"rangers":["stale-copy"]}')
    expect(localStorage.getItem('radioLog')).toBe('{"logEntries":["legacy-only"]}')
  })
})

describe('RecordStore.reloadKey (E-313)', () => {
  const REMOVE = '@@remove@@' // rawPut's "delete this key"
  function rawPut(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(STORE, 'readwrite')
        if (value === REMOVE) tx.objectStore(STORE).delete(key)
        else tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('picks up what another window wrote, and what it removed, without writing anything', async () => {
    await rawPut('radioLog', '{"v":1}')
    await recordStore.load({ readOnly: true })
    recordStore.useReadOnly()
    expect(recordStore.getItem('radioLog')).toBe('{"v":1}')

    await rawPut('radioLog', '{"v":2}') // the main window writes
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const del = vi.spyOn(IDBObjectStore.prototype, 'delete')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    expect(await recordStore.reloadKey('radioLog')).toBe(true)
    expect(recordStore.getItem('radioLog')).toBe('{"v":2}')

    put.mockRestore(); del.mockRestore()
    await rawPut('radioLog', REMOVE) // the main window removes it
    const put2 = vi.spyOn(IDBObjectStore.prototype, 'put')
    const del2 = vi.spyOn(IDBObjectStore.prototype, 'delete')
    expect(await recordStore.reloadKey('radioLog')).toBe(true)
    expect(recordStore.getItem('radioLog')).toBeNull()

    for (const spy of [put, del, put2, del2, set]) expect(spy).not.toHaveBeenCalled()
  })

  it('does not create the database when there is none, and does not write when asked to set something', async () => {
    recordStore.useReadOnly()
    await recordStore.load({ readOnly: true })
    const names = (await indexedDB.databases()).map(d => d.name)
    expect(names).not.toContain(DB_NAME)
    recordStore.setItem('rangers', '{"x":1}')
    expect(recordStore.getItem('rangers')).toBeNull()
  })

  it('keeps what is on screen when the stored record cannot be read', async () => {
    await rawPut('rangers', '{"v":1}')
    await recordStore.load({ readOnly: true })
    // An encrypted-looking envelope with no key: "treated as missing" must not blank the window.
    await rawPut('rangers', JSON.stringify({ iv: 'AAAA', ciphertext: 'AAAA' }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await recordStore.reloadKey('rangers')).toBe(false)
    expect(recordStore.getItem('rangers')).toBe('{"v":1}')
  })
})

