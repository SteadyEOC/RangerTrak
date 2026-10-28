import { BOARD_HTTP_ERROR, normaliseBoardAddress } from './board-address'

describe('normaliseBoardAddress', () => {
  it('leaves a clean address alone', () => {
    expect(normaliseBoardAddress('https://rangertrak-board.local')).toEqual({ url: 'https://rangertrak-board.local' })
    expect(normaliseBoardAddress('https://192.168.1.5:8080')).toEqual({ url: 'https://192.168.1.5:8080' })
  })
  it('trims and drops a trailing slash', () => {
    expect(normaliseBoardAddress('  https://rangertrak-board.local/  ').url).toBe('https://rangertrak-board.local')
    expect(normaliseBoardAddress('https://x.local///').url).toBe('https://x.local')
  })
  it('strips /view and says so', () => {
    expect(normaliseBoardAddress('https://x.local/view')).toEqual({ url: 'https://x.local', strippedView: true })
    expect(normaliseBoardAddress('https://x.local/view/')).toEqual({ url: 'https://x.local', strippedView: true })
    expect(normaliseBoardAddress('https://x.local:8080/VIEW')).toEqual({ url: 'https://x.local:8080', strippedView: true })
  })
  it('strips /qr and /hello without the viewer hint', () => {
    expect(normaliseBoardAddress('https://x.local/qr')).toEqual({ url: 'https://x.local' })
    expect(normaliseBoardAddress('https://x.local/hello/')).toEqual({ url: 'https://x.local' })
  })
  it('adds https:// when there is no scheme', () => {
    expect(normaliseBoardAddress('rangertrak-board.local')).toEqual({ url: 'https://rangertrak-board.local' })
    expect(normaliseBoardAddress('192.168.1.5:8080/view')).toEqual({ url: 'https://192.168.1.5:8080', strippedView: true })
  })
  it('refuses http:// and leaves it as typed', () => {
    expect(normaliseBoardAddress('http://x.local/view')).toEqual({ error: BOARD_HTTP_ERROR })
    expect(normaliseBoardAddress('HTTP://x.local')).toEqual({ error: BOARD_HTTP_ERROR })
  })
  it('marks addresses that only work on this computer', () => {
    expect(normaliseBoardAddress('https://localhost')).toEqual({ url: 'https://localhost', thisComputerOnly: true })
    expect(normaliseBoardAddress('localhost:8080/view')).toEqual({ url: 'https://localhost:8080', strippedView: true, thisComputerOnly: true })
    expect(normaliseBoardAddress('https://127.0.0.1')).toEqual({ url: 'https://127.0.0.1', thisComputerOnly: true })
    expect(normaliseBoardAddress('https://[::1]:8080')).toEqual({ url: 'https://[::1]:8080', thisComputerOnly: true })
    expect(normaliseBoardAddress('https://localhost.example.org').thisComputerOnly).toBeUndefined()
  })
  it('treats blank as nothing typed', () => {
    expect(normaliseBoardAddress('   ')).toEqual({ url: '' })
    expect(normaliseBoardAddress(undefined)).toEqual({ url: '' })
  })
})
