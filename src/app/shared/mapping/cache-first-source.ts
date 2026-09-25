import { FetchSource, type RangeResponse, type Source } from 'pmtiles'

/** How long a cache MISS is trusted before Cache Storage is asked again. A hit is kept for
 *  the life of the source - see `cachedBlob()`. */
const MISS_RECHECK_MS = 5_000

/**
 * A pmtiles `Source` that reads the bundled archive from the copy `OfflineBasemapService`
 * warmed into Cache Storage, and only goes to the network when there is no such copy.
 *
 * WHY THIS EXISTS (found 2026-09-25 by a real offline test - local server stopped, browser
 * restarted on the same profile): the Alternative map was BLANK offline. pmtiles-js's own
 * `FetchSource` reads the archive in HTTP Range requests; `ngsw-config.json` deliberately
 * excludes `/assets/maps/**` (the 2026-09-01 fix - ngsw answered Range requests with a
 * whole cached 200), so offline those requests went to a network that wasn't there and
 * came back 504 from the very first header read. Meanwhile `OfflineBasemapService` had the
 * complete archive sitting in Cache Storage, and `MissionReadinessService` reported the map
 * as warmed from it - but nothing ever READ that copy. This is the reader.
 *
 * Slicing a `Blob` rather than holding an `ArrayBuffer`: `Response.blob()` on a Cache
 * Storage entry is disk-backed in Chromium and WebKit, so a ~16 MB archive is not pulled
 * into memory - each `getBytes()` reads just its own range, the same way pmtiles-js's
 * `FileSource` reads a user-supplied file.
 *
 * No ETag on cache reads: Cache Storage is keyed by URL, and a changed archive always gets a
 * new URL (see `pmtiles-config.ts`), so the cached copy cannot be a stale version of the URL
 * it is stored under. `FetchSource` only raises `EtagMismatch` when both the expected and the
 * returned ETag are present, so a header read from cache (no ETag) followed by a network
 * read, or the reverse, never trips it.
 */
export class CacheFirstSource implements Source {
  private readonly network: FetchSource
  private hit: Promise<Blob | null> | null = null
  private missCheckedAt = 0

  constructor(private readonly url: string, private readonly cacheName: string) {
    this.network = new FetchSource(url)
  }

  /** Must stay the exact URL string - `Protocol.add()` keys on it, and the style's
   *  `pmtiles://<url>` is resolved back to this same key (see map-style.ts). */
  getKey(): string {
    return this.url
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const blob = await this.cachedBlob()
    if (blob && offset + length <= blob.size) {
      return { data: await blob.slice(offset, offset + length).arrayBuffer() }
    }
    return this.network.getBytes(offset, length, signal, etag)
  }

  /**
   * A hit is memoized for the life of this source. A miss is re-checked, but at most every
   * MISS_RECHECK_MS: on a device's first visit the archive is still downloading while the map
   * is already reading, and once `warm()` finishes, later reads should switch to the cached
   * copy without a reload - but not at the price of a Cache Storage lookup for every tile.
   */
  private cachedBlob(): Promise<Blob | null> {
    if (this.hit) return this.hit
    const now = Date.now()
    if (now - this.missCheckedAt < MISS_RECHECK_MS) return Promise.resolve(null)
    this.missCheckedAt = now
    const lookup = this.lookup()
    this.hit = lookup
    lookup.then(blob => { if (!blob) this.hit = null })
    return lookup
  }

  private async lookup(): Promise<Blob | null> {
    try {
      if (typeof caches === 'undefined') return null // not a secure context, or no Cache API
      const cache = await caches.open(this.cacheName)
      const res = await cache.match(this.url)
      return res ? await res.blob() : null
    } catch {
      return null // a failed lookup must never break the map - fall back to the network
    }
  }
}
