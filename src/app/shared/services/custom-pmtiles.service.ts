import { Injectable, signal } from '@angular/core'

import { LogService } from './log.service'

/**
 * A scribe-supplied `.pmtiles` file, stored on THIS device only, for MapLibre to use in
 * place of the bundled world base (and any demo's street detail).
 *
 * Raised in the roadmap's own "New backlog items, 2026-08-27": MapLibre's only offline
 * coverage is that one bundled file - unlike Leaflet's `leaflet.offline`, which fetches and
 * caches individual raster tiles live as a scribe pans around, PMTiles is a single archive
 * covering one fixed region, so there is no per-tile "save what I'm looking at" equivalent
 * to build here. The roadmap named the two realistic options: "bundle another region"
 * (a GIS data-generation task - tippecanoe/planetiler against real source data, not
 * something a coding session can produce) or "let a scribe supply their own .pmtiles file."
 * This is the second one: a coordinator who has generated or downloaded coverage for their
 * own area of operations loads it here, once, and it persists on this device from then on.
 *
 * D-35: operator data, same as ranger photos - never bundled into the repo, stored only in
 * this browser's IndexedDB. Same storage shape as `RangerPhotoService` (a single object
 * store, Blobs as values) - IndexedDB is the only browser storage that can hold a file this
 * large (a real regional PMTiles extract easily runs tens of MB; `localStorage`'s ~5-10MB
 * quota and string-only values rule it out entirely).
 */

const DB_NAME = 'rangertrak-custom-pmtiles'
const DB_VERSION = 1
const STORE = 'files'
/** The one slot this store holds - v1 is a single active custom map, not a library of them. */
const KEY = 'active'

export type StoredPmtilesFile = { name: string; blob: Blob }

@Injectable({ providedIn: 'root' })
export class CustomPmtilesService {

  private id = 'Custom PMTiles Service'
  private db?: IDBDatabase

  /** The currently active custom file, or null when none is loaded (using the bundled map).
   *  Populated once IndexedDB has been read on startup - see whenReady(). */
  public active = signal<StoredPmtilesFile | null>(null)

  private ready: Promise<void>

  constructor(private log: LogService) {
    this.ready = this.open()
      .then(() => this.loadStored())
      .catch(e => this.log.warn(`Custom PMTiles storage unavailable on this device: ${e?.message ?? e}`, this.id))
  }

  /** Resolves once any previously-stored file has been read into `active`. */
  whenReady(): Promise<void> { return this.ready }

  /** Reconstructs a real browser `File` from the stored Blob - pmtiles-js's `FileSource`
   *  wants a `File` (it reads `.name` as the archive's key), not a bare `Blob`. */
  activeFile(): File | null {
    const stored = this.active()
    return stored ? new File([stored.blob], stored.name) : null
  }

  /** Stores a new custom file, replacing any previous one. Does not itself touch the map -
   *  callers reload the page afterward (same "Reloading so every screen picks them up..."
   *  pattern Rangers' own roster/photo imports already use), since swapping a MapLibre
   *  style's tile source live is far more error-prone than starting fresh. */
  async setFile(file: File): Promise<void> {
    await this.ready
    const blob = new Blob([file], { type: file.type })
    await this.put({ name: file.name, blob })
    this.active.set({ name: file.name, blob })
    this.log.info(`Stored custom PMTiles file "${file.name}" (${(blob.size / 1_048_576).toFixed(1)} MB).`, this.id)
  }

  /** Forgets the stored file. The bundled map files are unaffected - it's a build asset,
   *  not something this service manages. */
  async clear(): Promise<void> {
    await this.ready
    if (!this.db) { this.active.set(null); return }
    await this.tx('readwrite', s => s.delete(KEY))
    this.active.set(null)
    this.log.warn('Cleared the custom PMTiles file. Maps will use the bundled map again.', this.id)
  }

  // ── internals ────────────────────────────────────────────────────────

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => { this.db = req.result; resolve() }
      req.onerror = () => reject(req.error)
    })
  }

  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new Error('custom PMTiles store not open')); return }
      const req = fn(this.db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private put(file: StoredPmtilesFile) { return this.tx('readwrite', s => s.put(file, KEY)) }

  private async loadStored(): Promise<void> {
    if (!this.db) return
    const stored = await this.tx<StoredPmtilesFile | undefined>('readonly', s => s.get(KEY))
    if (stored) {
      this.active.set(stored)
      this.log.info(`Loaded custom PMTiles file "${stored.name}" from this device.`, this.id)
    }
  }
}
