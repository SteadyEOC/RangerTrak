import { DevicePrefsService } from './device-prefs.service'

describe('DevicePrefsService', () => {
  const keys = [
    'lastCoordinateFormat',
    'rangertrak.rangers.privacyNoticeDismissed',
    'rt-board-publisher',
    'rt-msg-station',
    'rt-grid-fit',
    'rt-log-rows-per-page',
  ]
  let prefs: DevicePrefsService

  beforeEach(() => {
    keys.forEach((k) => localStorage.removeItem(k))
    prefs = new DevicePrefsService()
  })
  afterEach(() => keys.forEach((k) => localStorage.removeItem(k)))

  it('keeps the keys the components used to write, so nothing stored moves', () => {
    prefs.setLastCoordinateFormat('UTM')
    prefs.dismissRangersPrivacyNotice()
    expect(localStorage.getItem('lastCoordinateFormat')).toBe('UTM')
    expect(localStorage.getItem('rangertrak.rangers.privacyNoticeDismissed')).toBe('true')
  })

  it('reads back what it wrote, and defaults when nothing is stored', () => {
    expect(prefs.getLastCoordinateFormat()).toBeNull()
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBe(false)
    prefs.setLastCoordinateFormat('MGRS')
    expect(prefs.getLastCoordinateFormat()).toBe('MGRS')
    expect(prefs.dismissRangersPrivacyNotice()).toBe(true)
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBe(true)
  })

  it('keeps RangerView publish key and replaced flag on the device (D-61)', () => {
    expect(prefs.getBoardPublisher()).toEqual({})
    prefs.setBoardPublisher({ base: 'https://b:8080', key: 'k' })
    expect(prefs.getBoardPublisher()).toEqual({ base: 'https://b:8080', key: 'k' })
    prefs.setBoardPublisher({ replaced: true })
    expect(prefs.getBoardPublisher()).toEqual({ replaced: true })
    prefs.setBoardPublisher({})
    expect(localStorage.getItem('rt-board-publisher')).toBeNull()
    localStorage.setItem('rt-board-publisher', '{not json')
    expect(prefs.getBoardPublisher()).toEqual({})
  })

  it('fails safe when storage throws (private browsing, full quota)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(prefs.getLastCoordinateFormat()).toBeNull()
    expect(prefs.isRangersPrivacyNoticeDismissed()).toBe(false)
    expect(() => prefs.setLastCoordinateFormat('DD')).not.toThrow()
    expect(prefs.dismissRangersPrivacyNotice()).toBe(false)
  })

  it('keeps the message-number station letter on the device: A by default, A to Z only (E-220)', () => {
    expect(prefs.getMsgStation()).toBe('A')
    expect(prefs.setMsgStation('c')).toBe(true)
    expect(prefs.getMsgStation()).toBe('C')
    expect(prefs.setMsgStation('AB')).toBe(false)
    expect(prefs.setMsgStation('1')).toBe(false)
    expect(prefs.getMsgStation()).toBe('C')
    localStorage.setItem('rt-msg-station', '9')
    expect(prefs.getMsgStation()).toBe('A')
  })

  it('keeps the Winlink call sign and saved addresses on the device, with safe defaults on an old store (E-307)', () => {
    // A returning user's storage has neither key: both read as their defaults.
    expect(prefs.getWinlinkCall()).toBe('')
    expect(prefs.getWinlinkAddresses()).toEqual([])
    expect(prefs.setWinlinkCall(' k7abc ')).toBe(true)
    expect(prefs.getWinlinkCall()).toBe('K7ABC')
    expect(prefs.setWinlinkAddresses([{ label: '', address: 'W7EOC' }, { label: 'x', address: ' ' }])).toBe(true)
    expect(prefs.getWinlinkAddresses()).toEqual([{ label: 'W7EOC', address: 'W7EOC' }])
    localStorage.setItem('rt-winlink-addresses', '{not json')
    expect(prefs.getWinlinkAddresses()).toEqual([])
    localStorage.setItem('rt-winlink-addresses', '"text"')
    expect(prefs.getWinlinkAddresses()).toEqual([])
    prefs.setWinlinkCall('')
    expect(localStorage.getItem('rt-winlink-call')).toBeNull()
  })

  it('remembers Fit to screen per grid, and reads unknown names as off', () => {
    expect(prefs.getGridFit('radio-log')).toBe(false)
    prefs.setGridFit('rangers', true)
    prefs.setGridFit('radio-log', true)
    prefs.setGridFit('rangers', false)
    expect(prefs.getGridFit('radio-log')).toBe(true)
    expect(prefs.getGridFit('rangers')).toBe(false)
    expect(localStorage.getItem('rt-grid-fit')).toBe('radio-log')
    localStorage.setItem('rt-grid-fit', 'junk,,')
    expect(prefs.getGridFit('radio-log')).toBe(false)
  })

  it('E-331: the log scrolls as one list by default and remembers Rows per page', () => {
    expect(prefs.getLogRowsPerPage()).toBe('All')
    prefs.setLogRowsPerPage('25')
    expect(prefs.getLogRowsPerPage()).toBe('25')
    expect(localStorage.getItem('rt-log-rows-per-page')).toBe('25')
    localStorage.setItem('rt-log-rows-per-page', '7')
    expect(prefs.getLogRowsPerPage()).toBe('All')
  })
})
