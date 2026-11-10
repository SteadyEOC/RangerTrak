import { GOOGLE_LOOKUP_TIMEOUT_MS, GoogleGeocoder } from './google-geocoder'

describe('GoogleGeocoder', () => {
  const g = globalThis as unknown as {
    google?: unknown
  }
  let saved: unknown

  beforeEach(() => {
    saved = g.google
    vi.useFakeTimers()
  })
  afterEach(() => {
    g.google = saved
    vi.useRealTimers()
  })
  /** Moves the fake clock on, running promise callbacks on the way (as fakeAsync tick() did). */
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

  /** A stand-in for the Maps JS API whose geocode() answers with `answer`. */
  function fakeGoogle(answer: () => Promise<unknown>) {
    g.google = {
      maps: {
        Geocoder: class {
          geocode = answer
        },
      },
    }
  }

  it('gives up when Google never answers (a bad key), instead of waiting forever', async () => {
    fakeGoogle(() => new Promise(() => {}))
    let result:
      | {
          found: boolean
          error?: string
        }
      | undefined
    new GoogleGeocoder('bad-key').geocodeAddress('Vashon, WA').then((r) => (result = r))

    await tick(GOOGLE_LOOKUP_TIMEOUT_MS - 1)
    expect(result).toBeUndefined()
    await tick(1)
    expect(result?.found).toBe(false)
    expect(result?.error).toContain('check the Google key')
  })

  it('returns the first result when Google answers in time', async () => {
    fakeGoogle(() =>
      Promise.resolve({
        results: [
          {
            geometry: { location: { lat: () => 47.45, lng: () => -122.46 } },
            formatted_address: 'Vashon, WA, USA',
          },
        ],
      })
    )
    let result:
      | {
          found: boolean
          address: string
          lat: number
        }
      | undefined
    new GoogleGeocoder('key').geocodeAddress('Vashon, WA').then((r) => (result = r))
    await tick()

    expect(result).toEqual(
      expect.objectContaining({ found: true, address: 'Vashon, WA, USA', lat: 47.45 })
    )
    expect(vi.getTimerCount()).toBe(0) // the timeout was cleared; nothing left pending
  })
})
