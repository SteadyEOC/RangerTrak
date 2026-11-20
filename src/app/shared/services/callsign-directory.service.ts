import { Injectable, signal } from '@angular/core'
import { openDB, type IDBPDatabase } from 'idb'

import { normalizeCall } from '../../domain/caller-kind'
import { CALLSIGN_DB_NAME } from '../../domain/callsign-directory-db'
import type { DirectoryMeta, DirectoryRow } from '../../domain/callsign-directory'
import type { ImportProgress } from '../../domain/callsign-directory-import'

const CALLS = 'calls'
const INCOMING = 'incoming'
const META = 'meta'
const META_KEY = 'current'

/** What Entry and the Radio Log need back from a lookup. */
export type DirectoryHit = { name: string; city: string; region: string }

/**
 * E-325: the offline call sign list (ISED for Canada, FCC for the US), one per DEVICE, not per mission.
 *
 * Public data, but still device data like map tiles: it is NEVER in backups, Setup files, Report Packets,
 * hand-overs or RangerView snapshots (rule 5, and the brief). Only call sign, name, city and province/state are
 * stored; the parser drops everything else.
 *
 * Entry and the Radio Log only call `lookup()`, a single keyed read. Reading and parsing the downloaded file
 * (`importFile`) lazy-loads `domain/callsign-directory-import` (fflate), so none of that is in the eager bundle.
 *
 * An import writes to a staging store, then swaps it in with one transaction, so a failed import leaves the old
 * list (or none), never a half-mix.
 */
@Injectable({ providedIn: 'root' })
export class CallsignDirectoryService {
  private dbPromise?: Promise<IDBPDatabase>
  private metaCache: DirectoryMeta | null | undefined = undefined

  /** The loaded list's details, for the Settings card; null = none. Updated by import and remove. */
  readonly metaSignal = signal<DirectoryMeta | null>(null)

  private open(): Promise<IDBPDatabase> {
    this.dbPromise ??= openDB(CALLSIGN_DB_NAME, 1, {
      upgrade(db) {
        for (const name of [CALLS, INCOMING]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
      },
    })
    return this.dbPromise
  }

  /** Details of the loaded list, or null when none (or when this browser has no IndexedDB). */
  async meta(): Promise<DirectoryMeta | null> {
    if (this.metaCache !== undefined) return this.metaCache
    try {
      const db = await this.open()
      this.metaCache = ((await db.get(META, META_KEY)) as DirectoryMeta | undefined) ?? null
    } catch {
      this.metaCache = null
    }
    this.metaSignal.set(this.metaCache)
    return this.metaCache
  }

  /**
   * undefined = no list loaded on this device; null = a list is loaded and this call is not in it; otherwise
   * the hit. The suffix and SSID are ignored, as callerKind does.
   */
  async lookup(call: string): Promise<DirectoryHit | null | undefined> {
    if (!(await this.meta())) return undefined
    const key = normalizeCall(call)
    if (!key) return null
    try {
      const db = await this.open()
      const row = (await db.get(CALLS, key)) as DirectoryRow | undefined
      return row ? { name: row.name, city: row.city, region: row.region } : null
    } catch {
      return undefined
    }
  }

  /**
   * Reads the file the user downloaded and replaces the list. Throws a plain-words Error when nothing could be
   * read or nothing matched; the previous list is untouched then.
   */
  async importFile(file: File, region: string, onProgress: (p: ImportProgress) => void): Promise<DirectoryMeta> {
    const db = await this.open()
    await db.clear(INCOMING)
    try {
      const { importDirectoryFile } = await import('../../domain/callsign-directory-import')
      const result = await importDirectoryFile(file, region, {
        put: async rows => {
          const tx = db.transaction(INCOMING, 'readwrite')
          for (const r of rows) void tx.store.put(r, r.call)
          await tx.done
        },
      }, onProgress)
      if (result.count === 0) {
        throw new Error('No call signs matched. Check the state or ZIP box, or that this is the right file.')
      }
      const meta: DirectoryMeta = {
        source: result.source, importedAt: new Date().toISOString(), fileName: file.name,
        ...(result.fileDate ? { fileDate: result.fileDate } : {}), region: result.region, count: result.count,
      }
      await this.swapIn(db, meta)
      this.metaCache = meta
      this.metaSignal.set(meta)
      return meta
    } catch (e) {
      await db.clear(INCOMING).catch(() => undefined)
      throw e
    }
  }

  /** One transaction: the staged rows replace the list, or nothing changes. */
  private async swapIn(db: IDBPDatabase, meta: DirectoryMeta): Promise<void> {
    const tx = db.transaction([CALLS, INCOMING, META], 'readwrite')
    await tx.objectStore(CALLS).clear()
    let cursor = await tx.objectStore(INCOMING).openCursor()
    while (cursor) {
      await tx.objectStore(CALLS).put(cursor.value, cursor.key)
      cursor = await cursor.continue()
    }
    await tx.objectStore(INCOMING).clear()
    await tx.objectStore(META).put(meta, META_KEY)
    await tx.done
  }

  /** E-328: every row, for a Setup file that carries the list. Empty when there is none. */
  async allRows(): Promise<DirectoryRow[]> {
    if (!(await this.meta())) return []
    const db = await this.open()
    return (await db.getAll(CALLS)) as DirectoryRow[]
  }

  /**
   * E-328: replaces the list with one that arrived in a Setup file (staging store, then the same one-transaction
   * swap as importFile), so a failure leaves the old list intact. Only call sign, name, city and region are kept.
   */
  async replaceAll(incoming: DirectoryMeta, rows: readonly DirectoryRow[]): Promise<DirectoryMeta> {
    const db = await this.open()
    await db.clear(INCOMING)
    try {
      for (let i = 0; i < rows.length; i += 5000) {
        const tx = db.transaction(INCOMING, 'readwrite')
        for (const r of rows.slice(i, i + 5000)) {
          void tx.store.put({ call: r.call, name: r.name, city: r.city, region: r.region }, r.call)
        }
        await tx.done
      }
      const meta: DirectoryMeta = { ...incoming, count: rows.length }
      await this.swapIn(db, meta)
      this.metaCache = meta
      this.metaSignal.set(meta)
      return meta
    } catch (e) {
      await db.clear(INCOMING).catch(() => undefined)
      throw e
    }
  }

  /** Removes the list from this device. */
  async remove(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([CALLS, INCOMING, META], 'readwrite')
    await Promise.all([tx.objectStore(CALLS).clear(), tx.objectStore(INCOMING).clear(), tx.objectStore(META).clear(), tx.done])
    this.metaCache = null
    this.metaSignal.set(null)
  }
}
