import { describe, expect, it } from 'vitest'
import { clock, reportFirstLine, reportFullText, stateChip } from './field-report-view'

describe('field report view words (D-69)', () => {
  const base = { date: new Date('2026-11-11T10:31:00') }

  it('first line is Notes, else the 213 subject, else the 213 message', () => {
    expect(reportFirstLine({ ...base, notes: '\n  Bridge out  \nmore' })).toBe('Bridge out')
    expect(reportFirstLine({ ...base, notes: ' ', subject213: 'Need water' })).toBe('Need water')
    expect(reportFirstLine({ ...base, message213: 'Send a truck' })).toBe('Send a truck')
    expect(reportFirstLine(base)).toBe('(no text)')
  })

  it('full text names who, status, notes and the 213 parts', () => {
    const t = reportFullText({ ...base, callsign: 'W7ABC', toCallsign: 'NET', status: 'Normal', notes: 'Hello', subject213: 'S', message213: 'M' })
    expect(t).toBe('From W7ABC to NET\nStatus: Normal\nHello\n213 subject: S\n213 message: M')
  })

  it('chips read Not sent, Sent hh:mm, Sent, Received with and without a number', () => {
    expect(stateChip(undefined)).toBe('Not sent')
    expect(stateChip({ sentAt: null })).toBe('Sent')
    expect(stateChip({ sentAt: new Date('2026-11-11T10:42:00').toISOString() })).toBe(`Sent ${clock('2026-11-11T10:42:00')}`)
    expect(stateChip({ sentAt: null, receivedAt: '2026-11-11T11:00:00Z', msgNo: 'A007' })).toBe('Received · A007')
    expect(stateChip({ sentAt: null, receivedAt: '2026-11-11T11:00:00Z' })).toBe('Received')
  })

  it('clock tolerates nothing and bad input', () => {
    expect(clock(null)).toBe('')
    expect(clock('nope')).toBe('')
  })

  it('shows a resource request (E-283) after the 213 fields', () => {
    const rr213 = { lines: [{ qty: '9', kind: 'Hard hat', description: '', neededBy: '' }], priority: 'urgent' as const, deliverTo: 'Patrol 2' }
    expect(reportFirstLine({ ...base, rr213 })).toBe('Resource request: 9 × Hard hat, Urgent, deliver to Patrol 2')
    expect(reportFirstLine({ ...base, rr213, message213: 'Send a truck' })).toBe('Send a truck')
    expect(reportFullText({ ...base, notes: 'Short on kit', rr213 })).toBe('Short on kit\nResource request: 9 × Hard hat, Urgent, deliver to Patrol 2')
  })
})
