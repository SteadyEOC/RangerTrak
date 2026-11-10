import { BoardRetry, retryDelayMs } from './board-retry'

describe('Board retry back-off', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const tick = (ms: number) => vi.advanceTimersByTime(ms)

  it('goes 5, 10, 20, 40 s then 60 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000, 60000,
    ])
  })

  it('retries on that schedule while attempts keep failing', () => {
    let runs = 0
    const retry = new BoardRetry(() => {
      runs++
      retry.failed()
    })
    retry.failed()
    tick(4999)
    expect(runs).toBe(0)
    tick(1)
    expect(runs).toBe(1) // 5 s
    tick(10000)
    expect(runs).toBe(2) // +10 s
    tick(20000)
    expect(runs).toBe(3) // +20 s
    tick(40000)
    expect(runs).toBe(4) // +40 s
    tick(60000)
    expect(runs).toBe(5) // +60 s
    tick(60000)
    expect(runs).toBe(6) // and every 60 s after
    retry.stop()
  })

  it('starts again at 5 s after a success', () => {
    let runs = 0
    const retry = new BoardRetry(() => {
      runs++
      retry.failed()
    })
    retry.failed()
    tick(5000)
    tick(10000)
    expect(runs).toBe(2)
    retry.succeeded()
    tick(120000)
    expect(runs).toBe(2) // success cancelled the timer
    retry.failed()
    tick(5000)
    expect(runs).toBe(3) // back to 5 s, not 20 s
    retry.stop()
  })

  it('does not stack timers when failures pile up', () => {
    let runs = 0
    const retry = new BoardRetry(() => {
      runs++
    })
    retry.failed()
    retry.failed()
    retry.failed()
    tick(5000)
    expect(runs).toBe(1)
    tick(120000)
    expect(runs).toBe(1)
  })

  it('runs at once when asked and leaves nothing running after stop', () => {
    let runs = 0
    const retry = new BoardRetry(() => {
      runs++
    })
    retry.failed()
    retry.now()
    expect(runs).toBe(1)
    tick(120000)
    expect(runs).toBe(1) // the waiting timer was cancelled
    retry.failed()
    retry.stop()
    tick(120000)
    expect(runs).toBe(1)
  })
})
