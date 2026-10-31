import { saveTileJobs, type TileSaveDeps, type TileSaveProgress } from './offline-tile-save'

// E-266: the offline-save loop keeps going past failed tiles and reports what happened.
describe('saveTileJobs (E-266)', () => {
  type Tile = { key: string, url: string }
  const tiles = (n: number): Tile[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, url: `u${i}` }))
  const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { status })

  /** Fake storage and network; `download` is overridden per test. */
  function fakes(over: Partial<TileSaveDeps<Tile>> = {}) {
    const stored = new Set<string>()
    const waits: number[] = []
    const deps: TileSaveDeps<Tile> = {
      has: async key => stored.has(key),
      download: async () => new Blob(['x']),
      save: async tile => { stored.add(tile.key) },
      wait: async ms => { waits.push(ms) },
      ...over
    }
    return { deps, stored, waits }
  }

  it('saves everything when every download works', async () => {
    const { deps, stored } = fakes()
    const seen: TileSaveProgress[] = []
    const result = await saveTileJobs(tiles(7), deps, { onProgress: p => seen.push(p) })
    expect(result).toEqual({ done: 7, total: 7, saved: 7, skipped: 0, failed: 0 })
    expect(stored.size).toBe(7)
    expect(seen.length).toBe(7)
    expect(seen[6].done).toBe(7)
  })

  it('counts permanent failures, still saves the rest, and resolves', async () => {
    const { deps, stored } = fakes({
      download: async url => {
        if (['u1', 'u3', 'u4', 'u8'].includes(url)) { throw httpError(504) }
        return new Blob(['x'])
      }
    })
    const result = await saveTileJobs(tiles(10), deps)
    expect(result).toEqual({ done: 10, total: 10, saved: 6, skipped: 0, failed: 4 })
    expect(stored.size).toBe(6)
  })

  it('retries a 504 with a pause and saves the tile when a retry works', async () => {
    let calls = 0
    const { deps, stored, waits } = fakes({
      download: async () => {
        calls++
        if (calls < 3) { throw httpError(504) }
        return new Blob(['x'])
      }
    })
    const result = await saveTileJobs(tiles(1), deps)
    expect(result.saved).toBe(1)
    expect(result.failed).toBe(0)
    expect(calls).toBe(3)
    expect(waits).toEqual([1000, 3000])
    expect(stored.size).toBe(1)
  })

  it('gives up after two retries', async () => {
    let calls = 0
    const { deps } = fakes({ download: async () => { calls++; throw httpError(503) } })
    const result = await saveTileJobs(tiles(1), deps)
    expect(calls).toBe(3)
    expect(result.failed).toBe(1)
  })

  it('retries a network error and a 429, but not a 404', async () => {
    const calls: Record<string, number> = {}
    const { deps } = fakes({
      download: async url => {
        calls[url] = (calls[url] ?? 0) + 1
        if (url === 'u0') { throw new TypeError('Failed to fetch') }
        if (url === 'u1') { throw httpError(429) }
        throw httpError(404)
      }
    })
    const result = await saveTileJobs(tiles(3), deps)
    expect(calls).toEqual({ u0: 3, u1: 3, u2: 1 })
    expect(result.failed).toBe(3)
  })

  it('counts tiles already stored as skipped without downloading them', async () => {
    const { deps, stored } = fakes()
    stored.add('k0')
    stored.add('k2')
    let downloads = 0
    const counting = { ...deps, download: async (u: string) => { downloads++; return deps.download(u) } }
    const result = await saveTileJobs(tiles(4), counting)
    expect(result).toEqual({ done: 4, total: 4, saved: 2, skipped: 2, failed: 0 })
    expect(downloads).toBe(2)
  })

  it('never has more than 3 downloads in flight', async () => {
    let inFlight = 0
    let peak = 0
    const { deps } = fakes({
      download: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 2))
        inFlight--
        return new Blob(['x'])
      }
    })
    const result = await saveTileJobs(tiles(20), deps)
    expect(result.saved).toBe(20)
    expect(peak).toBe(3)
  })

  it('counts a tile that cannot be stored as failed', async () => {
    const { deps } = fakes({ save: async () => { throw new Error('quota') } })
    const result = await saveTileJobs(tiles(2), deps)
    expect(result.failed).toBe(2)
  })

  it('falls back to the next stand-in only when the first is missing (404)', async () => {
    const { deps, stored } = fakes({
      download: async url => {
        if (url === 'child') { throw httpError(404) }
        return new Blob(['x'])
      }
    })
    const job = [{ key: 'c', url: 'child' }, { key: 'p', url: 'parent' }]
    const result = await saveTileJobs([job], deps)
    expect(result.saved).toBe(1)
    expect([...stored]).toEqual(['p'])
  })

  it('does not fall back after a server error that outlasted the retries', async () => {
    const { deps, stored } = fakes({ download: async () => { throw httpError(504) } })
    const job = [{ key: 'c', url: 'child' }, { key: 'p', url: 'parent' }]
    const result = await saveTileJobs([job], deps)
    expect(result.failed).toBe(1)
    expect(stored.size).toBe(0)
  })

  it('handles an empty list', async () => {
    const { deps } = fakes()
    expect(await saveTileJobs([], deps)).toEqual({ done: 0, total: 0, saved: 0, skipped: 0, failed: 0 })
  })
})
