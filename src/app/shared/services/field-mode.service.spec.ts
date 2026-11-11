import { TestBed } from '@angular/core/testing'

import { FieldModeService } from './field-mode.service'

const clearKeys = () => {
  localStorage.removeItem('fieldModeSentUids')
  localStorage.removeItem('fieldModeReports')
}

describe('FieldModeService', () => {
  let service: FieldModeService

  beforeEach(() => {
    clearKeys()
    service = TestBed.inject(FieldModeService)
  })

  afterEach(clearKeys)

  it('counts reports not yet in a Report Packet, and reports with no uid as unsent', () => {
    service.markSent(['a'])
    expect(service.unsentCount([{ uid: 'a' }, { uid: 'b' }, {}])).toBe(2)
  })

  // 2026-10-28, John: a phone with unsent reports warns before leaving field mode.
  it('names the unsent reports in the leave prompt, and does nothing on Cancel', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const disableSpy = vi.spyOn(service, 'disable').mockReturnValue(undefined)

    service.confirmAndTurnOff(5)
    expect(vi.mocked(confirmSpy).mock.lastCall![0]).toContain(
      '5 reports on this phone have not been sent yet'
    )

    service.confirmAndTurnOff(1)
    expect(vi.mocked(confirmSpy).mock.lastCall![0]).toContain(
      '1 report on this phone has not been sent yet'
    )

    service.confirmAndTurnOff(0)
    expect(vi.mocked(confirmSpy).mock.lastCall![0]).not.toContain('not been sent')
    expect(disableSpy).not.toHaveBeenCalled()
  })

  // E-251/E-253 (D-69): three states, kept in one map.
  describe('report states (D-69)', () => {
    const t1 = new Date('2026-11-11T10:42:00Z')
    const t2 = new Date('2026-11-11T11:00:00Z')

    it('folds the old sent list in once, as sent at an unknown time, and removes the old key', () => {
      localStorage.setItem('fieldModeSentUids', JSON.stringify(['a', 'b']))
      TestBed.resetTestingModule()
      const fresh = TestBed.inject(FieldModeService)
      expect(fresh.stateOf('a')).toBe('sent')
      expect(fresh.reports()['a']).toEqual({ sentAt: null })
      expect(localStorage.getItem('fieldModeSentUids')).toBeNull()
      expect(JSON.parse(localStorage.getItem('fieldModeReports')!)).toEqual({ a: { sentAt: null }, b: { sentAt: null } })
    })

    it('moves not-sent to sent to received, and received never goes back to sent', () => {
      expect(service.stateOf('x')).toBe('not-sent')
      service.markSent(['x'], t1)
      expect(service.stateOf('x')).toBe('sent')
      expect(service.reports()['x'].sentAt).toBe(t1.toISOString())
      expect(service.markReceived(['x'], t2, new Map([['x', 'A007']]))).toBe(1)
      expect(service.stateOf('x')).toBe('received')
      expect(service.reports()['x'].msgNo).toBe('A007')
      // sending again keeps it received; a second receipt changes nothing
      service.markSent(['x'], t2)
      expect(service.stateOf('x')).toBe('received')
      expect(service.markReceived(['x'], t2)).toBe(0)
    })

    it('sorts entries into new, unconfirmed and received; an entry with no uid is new', () => {
      service.markSent(['s', 'r'], t1)
      service.markReceived(['r'], t2)
      const entries = [{ uid: 'n' }, { uid: 's' }, { uid: 'r' }, {}]
      expect(service.newEntries(entries)).toEqual([{ uid: 'n' }, {}])
      expect(service.unconfirmedEntries(entries)).toEqual([{ uid: 's' }])
      expect(service.receivedEntries(entries)).toEqual([{ uid: 'r' }])
      expect(service.unsentCount(entries)).toBe(2)
    })

    it('forget drops reports, and an unreadable key reads as empty', () => {
      service.markSent(['a', 'b'], t1)
      service.forget(['a'])
      expect(service.stateOf('a')).toBe('not-sent')
      expect(service.stateOf('b')).toBe('sent')
      localStorage.setItem('fieldModeReports', '{not json')
      TestBed.resetTestingModule()
      expect(TestBed.inject(FieldModeService).reports()).toEqual({})
    })

    it('disable removes both keys', () => {
      service.markSent(['a'], t1)
      localStorage.setItem('fieldModeSentUids', '[]')
      service.disable()
      expect(localStorage.getItem('fieldModeReports')).toBeNull()
      expect(localStorage.getItem('fieldModeSentUids')).toBeNull()
    })
  })
})
