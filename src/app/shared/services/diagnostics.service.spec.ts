import { TestBed } from '@angular/core/testing'

import { DiagnosticsService } from './diagnostics.service'
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
})
