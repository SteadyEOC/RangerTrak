import { TestBed } from '@angular/core/testing'

import { DiagnosticsService, utcOffset } from './diagnostics.service'
import { LogService } from './log.service'

describe('DiagnosticsService (E-258)', () => {
  it('includes redacted Error text but never the message of an ordinary entry', async () => {
    const log = TestBed.inject(LogService)
    log.info('Radio log entry for Jane Smith at 47.4471, -122.4627', 'Entry Component')
    log.error('Boom: call 206-555-0142 or jane@example.org', 'Unhandled Error')

    const report = await TestBed.inject(DiagnosticsService).report()

    expect(report).not.toContain('Jane Smith')
    expect(report).not.toContain('47.4471')
    expect(report).toContain('Entry Component')
    expect(report).toContain('Boom: call [number] or [email]')
    expect(report).not.toContain('555-0142')
    expect(report.length).toBeLessThanOrEqual(2500)
  })

  it('says a service worker is registered when it is not controlling this load (hard refresh)', async () => {
    if (!navigator.serviceWorker) {
      pending('no serviceWorker in this browser')
      return
    }
    expect(navigator.serviceWorker.controller).toBeNull()
    const spy = spyOn(navigator.serviceWorker, 'getRegistration')
    spy.and.resolveTo({} as ServiceWorkerRegistration)
    expect(await TestBed.inject(DiagnosticsService).report())
      .toContain('Service worker active: registered, not controlling this load')

    spy.and.resolveTo(undefined)
    expect(await TestBed.inject(DiagnosticsService).report()).toContain('Service worker active: no\n')
  })

  it('stamps entries in local time and states the UTC offset once', async () => {
    const log = TestBed.inject(LogService)
    log.warn('Something odd', 'Stamp Test')
    const d = new Date(log.entries().slice(-1)[0].date)
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

    const report = await TestBed.inject(DiagnosticsService).report()

    expect(report).toContain(`${local} Warn Stamp Test`)
    expect(report).toContain(`Times: local, ${utcOffset(new Date())}`)
  })

  it('formats UTC offsets the way John chose', () => {
    const at = (offsetMin: number) => ({ getTimezoneOffset: () => offsetMin }) as Date
    expect(utcOffset(at(420))).toBe('UTC−7')
    expect(utcOffset(at(-330))).toBe('UTC+5:30')
    expect(utcOffset(at(0))).toBe('UTC')
  })

  it('leaves Verbose and Excessive entries out of Recent activity', async () => {
    const log = TestBed.inject(LogService)
    log.excessive('tick', 'Chatty Excessive')
    log.verbose('tick', 'Chatty Verbose')
    log.info('Mission opened', 'Mission Info')

    const report = await TestBed.inject(DiagnosticsService).report()

    expect(report).not.toContain('Chatty Excessive')
    expect(report).not.toContain('Chatty Verbose')
    expect(report).toContain('Info Mission Info')
  })
})
