// E-266: the "Save this area for offline use" download loop, ours rather than leaflet.offline's.
// The plugin's own loop (ControlSaveTiles._saveTiles) lets one failed tile - OpenTopoMap often
// answers 504 under load - kill one of its three workers, so three failures end the whole save
// without a word, and its `saveend` event never fires for a partial save or for tiles that were
// already stored. This loop retries, counts every tile as saved, skipped or failed, and always
// resolves, so the caller can show a result. Pure: storage and network are injected.

export interface TileSaveProgress {
  /** Tiles finished one way or another (saved + skipped + failed). */
  done: number
  total: number
  /** Downloaded and stored just now. */
  saved: number
  /** Already stored on this device, so not downloaded again. */
  skipped: number
  /** Couldn't be downloaded (or stored) even after retrying. */
  failed: number
}

export interface TileSaveDeps<T extends { key: string, url: string }> {
  has(key: string): Promise<boolean>
  /** Rejects on a bad response; give the error a numeric `status` so 4xx isn't retried. */
  download(url: string): Promise<Blob>
  save(tile: T, blob: Blob): Promise<unknown>
  /** Pause between retries; tests pass a zero-delay one. */
  wait?(ms: number): Promise<void>
}

export interface TileSaveOptions {
  /** Downloads at once (default 3). */
  parallel?: number
  /** One retry per entry, after this many ms each (default 1 s then 3 s). */
  retryDelaysMs?: number[]
  onProgress?(progress: TileSaveProgress): void
}

/**
 * A job is one tile, or a list of stand-ins tried in order: the next is used only when the one
 * before is missing at the server (a 4xx) - how the shaded relief falls back to a parent tile.
 */
export type TileJob<T> = T | T[]

/** A server hiccup or a dropped connection is worth another try; a 404 and the like is not. */
export function isRetryableTileError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status !== 'number' || status >= 500 || status === 429
}

/** Saves every job, `parallel` at a time. Never rejects; the result says how it went. */
export async function saveTileJobs<T extends { key: string, url: string }>(
  jobs: TileJob<T>[],
  deps: TileSaveDeps<T>,
  options: TileSaveOptions = {}
): Promise<TileSaveProgress> {
  const parallel = Math.max(1, options.parallel ?? 3)
  const delays = options.retryDelaysMs ?? [1000, 3000]
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const progress: TileSaveProgress = { done: 0, total: jobs.length, saved: 0, skipped: 0, failed: 0 }
  const queue = [...jobs]

  const download = async (url: string): Promise<Blob> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await deps.download(url)
      } catch (err) {
        if (attempt >= delays.length || !isRetryableTileError(err)) {
          throw err
        }
        await wait(delays[attempt])
      }
    }
  }

  /** Resolves to what happened to this job; never throws. */
  const run = async (job: TileJob<T>): Promise<'saved' | 'skipped' | 'failed'> => {
    const candidates = Array.isArray(job) ? job : [job]
    for (let i = 0; i < candidates.length; i++) {
      const tile = candidates[i]
      try {
        if (await deps.has(tile.key)) {
          return 'skipped'
        }
        await deps.save(tile, await download(tile.url))
        return 'saved'
      } catch (err) {
        // Only a tile missing at the server moves on to the next stand-in.
        if (isRetryableTileError(err)) {
          return 'failed'
        }
      }
    }
    return 'failed'
  }

  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      progress[await run(job)]++
      progress.done++
      try {
        options.onProgress?.({ ...progress })
      } catch {
        // a broken progress display must not stop the save
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
  return { ...progress }
}
