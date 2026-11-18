/**
 * E-307: the Pat outbox folder, for Chromium's File System Access API. The picked folder's handle is
 * kept in IndexedDB so the next save is one click (a browser asks again for permission once per visit;
 * "re-arm" is that one click). Other browsers have no folder picking and download the file instead.
 * A handle never leaves the device (it is meaningless elsewhere).
 */

const DB_NAME = 'rangertrak-folders'
const STORE = 'handles'
const PAT_KEY = 'pat-outbox'

/** The slice of the File System Access API used here (the DOM lib does not type all of it). */
export interface DirHandle {
  readonly name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: BufferSource): Promise<void>, close(): Promise<void> }> }>
  queryPermission?(opts: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
  requestPermission?(opts: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
}

export function canPickFolder(win: object = window): boolean {
  return typeof (win as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** The remembered Pat outbox folder, or null (none picked, IndexedDB refused, ...). Never throws. */
export async function loadPatFolder(): Promise<DirHandle | null> {
  try {
    const h = await withStore<unknown>('readonly', s => s.get(PAT_KEY))
    return h && typeof (h as DirHandle).getFileHandle === 'function' ? h as DirHandle : null
  } catch {
    return null
  }
}

export async function savePatFolder(handle: DirHandle | null): Promise<void> {
  try {
    await withStore('readwrite', s => handle ? s.put(handle, PAT_KEY) : s.delete(PAT_KEY))
  } catch { /* the folder is just asked for again next time */ }
}

/** Shows the browser's folder picker. Null when cancelled. Must run from a click. */
export async function pickPatFolder(): Promise<DirHandle | null> {
  try {
    const pick = (window as unknown as { showDirectoryPicker: (o: { mode: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker
    const handle = await pick.call(window, { mode: 'readwrite' })
    await savePatFolder(handle)
    return handle
  } catch {
    return null
  }
}

/** True when the folder can be written now. With `ask`, shows the permission prompt (needs a click). */
export async function patFolderReady(handle: DirHandle, ask: boolean): Promise<boolean> {
  try {
    if (!handle.queryPermission) return true
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true
    return ask && !!handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) === 'granted'
  } catch {
    return false
  }
}

/** Writes one file into the folder, replacing a file of the same name. */
export async function writeIntoFolder(handle: DirHandle, name: string, bytes: Uint8Array): Promise<void> {
  const file = await handle.getFileHandle(name, { create: true })
  const w = await file.createWritable()
  await w.write(bytes as BufferSource)
  await w.close()
}
