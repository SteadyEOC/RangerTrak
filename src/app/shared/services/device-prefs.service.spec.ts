import { DevicePrefsService } from './device-prefs.service'

describe('DevicePrefsService', () => {
  const keys = ['lastCoordinateFormat', 'rangertrak.rangers.privacyNoticeDismissed']
  let prefs: DevicePrefsService

  beforeEach(() => {
    keys.forEach(k => localStorage.removeItem(k))
    prefs = new DevicePrefsService()
  })
  afterEach(() => keys.forEach(k => localStorage.removeItem(k)))

  it('keeps the keys the components used to write, so nothing stored moves', () => {
    prefs.setLastCoordinateFormat('UTM')
    prefs.dismissRangersPrivacyNotice()
    expect(localStorage.getItem('lastCoordinateFormat')).toBe('UTM')
    expect(localStorage.getItem('rangertrak.rangers.privacyNoticeDismissed')).toBe('true')
  })

  it('reads back what it wrote, and defaults when nothing is stored', () => {
    expect(prefs.getLastCoordinateFormat()).toBeNull()
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBeFalse()
    prefs.setLastCoordinateFormat('MGRS')
    expect(prefs.getLastCoordinateFormat()).toBe('MGRS')
    expect(prefs.dismissRangersPrivacyNotice()).toBeTrue()
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBeTrue()
  })

  it('fails safe when storage throws (private browsing, full quota)', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError')
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError')
    expect(prefs.getLastCoordinateFormat()).toBeNull()
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBeFalse()
    expect(() => prefs.setLastCoordinateFormat('DD')).not.toThrow()
    expect(prefs.dismissRangersPrivacyNotice()).toBeFalse()
  })
})
