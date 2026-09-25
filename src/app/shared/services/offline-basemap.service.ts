import { Injectable, signal } from '@angular/core'

import { DEFAULT_PMTILES_URL, PMTILES_WARM_CACHE_NAME as CACHE_NAME } from '../mapping/pmtiles-config'
import { LogService } from './log.service'

/** Reset on every chunk received, not a fixed total deadline - a real 15-20 MB archive over
 *  slow field LTE can legitimately take longer than any fixed total would allow. This is a
 *  STALL detector: no bytes at all for this long means the connection is dead, not slow. */
const STALL_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 2_000

/**
 * Warms the Cache Storage entry both `MapLibreComponent` (renders from it offline) and
 * `MissionReadinessService` (`caches.match()`, to report the "Alternative map warmed"
 * signal) read - see `DEFAULT_PMTILES_URL`'s own doc comment for what it now points at.
 *
 * Scoping doc "Offline Map Coverage Beyond Vashon", Q6 YES addendum (2026-09-14): the
 * previous version of this logic (`MapLibreComponent.warmBundledPmtilesCache()`) was a plain
 * `fetch()` + `cache.put()` that re-downloaded on every single visit (nothing checked
 * whether the entry was already there) and had no story at all for a dropped or stalled
 * connection - tolerable for a 1.7 MB Vashon-only file, not for the ~16 MB merged world+
 * Vashon archive this now warms. Hardened here against the failure modes that actually
 * matter for a coordinator prepping a device before losing signal:
 *
 * - **Already warmed:** `cache.match()` first - a hit means this exact `DEFAULT_PMTILES_URL`
 *   is already cached, so nothing more happens. Cache Storage matches by URL, not content,
 *   so replacing the archive again later needs a new URL (see `pmtiles-config.ts`) or this
 *   check would wrongly call an old cached copy "current."
 * - **A stalled connection that never errors or completes:** an `AbortController` reset on
 *   every chunk `reader.read()` yields, not a fixed total timeout.
 * - **A dropped connection:** bounded retries with exponential backoff, then a final fallback
 *   that waits for the browser's own `online` event and tries again - covers a coordinator
 *   who loses signal mid-download and regains it later without reopening the page.
 * - **A metered/low-data connection:** `navigator.connection.saveData` skips AUTOMATIC
 *   warming, but never the deliberate act of opening the alternative (MapLibre) map itself -
 *   see `warm()`'s own `userInitiated` parameter.
 * - **Atomic Cache Storage write:** the body is read and fully assembled in memory FIRST;
 *   `cache.put()` only ever receives a complete, real `Response`. Cache Storage has no
 *   partial-entry state, so a response constructed from a still-streaming body (or a naive
 *   `cache.put(url, await fetch(url))` where the fetch itself later aborts mid-stream) risks
 *   caching a truncated archive that then fails however pmtiles-js reads it back - much
 *   worse than just failing to cache at all, since it would report the map as "warmed" and
 *   ready when it silently isn't.
 */
@Injectable({ providedIn: 'root' })
export class OfflineBasemapService {
  private id = 'Offline Basemap Service'
  private warming = false
  private onlineRetryArmed = false

  /** 0-99 while a download is actively in flight, 100 briefly on completion, then null -
   *  null the rest of the time. Drives the readiness row's "Downloading offline world
   *  map… NN%" text (see HeaderComponent.readinessItems()); null means show the normal
   *  warmed/not-warmed line instead. */
  readonly downloadProgress = signal<number | null>(null)

  constructor(private log: LogService) { }

  /**
   * `userInitiated`: true when this call IS the deliberate "open the alternative map" action
   * (MapLibreComponent's own call site, on the map's 'idle' event, only ever fires because a
   * scribe switched to viewing it) - the scoping doc's own exception to the Data-Saver skip
   * below. Defaults false for any future purely-automatic/background call site.
   */
  async warm(options: { userInitiated: boolean } = { userInitiated: false }): Promise<void> {
    if (this.warming || typeof caches === 'undefined') {
      return
    }

    const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData && !options.userInitiated) {
      this.log.info('Skipping automatic offline-map warm: Data Saver is on.', this.id)
      return
    }

    this.warming = true
    try {
      const cache = await caches.open(CACHE_NAME)
      const existing = await cache.match(DEFAULT_PMTILES_URL)
      if (existing) {
        return
      }
      await this.downloadWithRetry(cache)
    } catch (err) {
      this.log.warn(`warm(): ${err}`, this.id)
    } finally {
      this.warming = false
      this.downloadProgress.set(null)
    }
  }

  private async downloadWithRetry(cache: Cache): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.downloadOnce(cache)
        return
      } catch (err) {
        this.log.warn(`Offline-map warm attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err}`, this.id)
        if (attempt === MAX_ATTEMPTS) {
          this.armOnlineRetry(cache)
          return
        }
        await this.delay(BASE_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
  }

  /** Final fallback once MAX_ATTEMPTS is exhausted: wait for the browser to report it's back
   *  online, then run the whole retry ladder again - covers a coordinator who loses signal
   *  mid-download and never reopens the page. Only one listener at a time. */
  private armOnlineRetry(cache: Cache): void {
    if (this.onlineRetryArmed || typeof window === 'undefined') {
      return
    }
    this.onlineRetryArmed = true
    const handler = () => {
      window.removeEventListener('online', handler)
      this.onlineRetryArmed = false
      this.downloadWithRetry(cache).catch(err =>
        this.log.warn(`Offline-map warm retry after 'online' failed: ${err}`, this.id))
    }
    window.addEventListener('online', handler)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * One attempt. Reads the body itself (rather than a plain `cache.put(url, await
   * fetch(url))`) for two reasons at once: it's what makes byte-level progress reporting
   * possible, AND it's what makes the stall timeout possible (a `fetch()` promise alone only
   * ever tells you headers arrived, not that the body is still moving).
   */
  private async downloadOnce(cache: Cache): Promise<void> {
    const controller = new AbortController()
    let stallTimer: ReturnType<typeof setTimeout>
    const resetStallTimer = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
    }
    resetStallTimer()

    try {
      const res = await fetch(DEFAULT_PMTILES_URL, { cache: 'no-store', signal: controller.signal })
      resetStallTimer()
      if (!res.ok || !res.body) {
        throw new Error(`Bad response: ${res.status}`)
      }

      const total = Number(res.headers.get('Content-Length') ?? 0)
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      for (; ;) {
        const { done, value } = await reader.read()
        resetStallTimer()
        if (done) {
          break
        }
        if (value) {
          chunks.push(value)
          received += value.byteLength
          this.downloadProgress.set(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null)
        }
      }

      // Atomic write: only a fully-assembled body ever reaches cache.put() - see this
      // class's own doc comment for why a partial entry would be worse than no entry.
      const body = new Blob(chunks as BlobPart[])
      const headers = new Headers(res.headers)
      await cache.put(DEFAULT_PMTILES_URL, new Response(body, { status: res.status, statusText: res.statusText, headers }))
      this.downloadProgress.set(100)
      this.log.info(`Warmed the offline basemap cache (${received} bytes).`, this.id)
    } finally {
      clearTimeout(stallTimer!)
    }
  }
}
