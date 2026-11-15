import { FullscreenService } from './fullscreen.service'

// E-315: the one Full screen action. A test page has no user gesture, so the real API is stubbed.
describe('FullscreenService (E-315)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-fullscreen-fallback')
    // Back to the real getter: the prototype's own fullscreenEnabled.
    delete (document as unknown as Record<string, unknown>)['fullscreenEnabled']
    vi.restoreAllMocks()
  })

  it('asks the registered element, else the whole document', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true })
    const service = new FullscreenService()
    const area = document.createElement('div')
    const areaSpy = vi.spyOn(area, 'requestFullscreen').mockResolvedValue(undefined)
    const rootSpy = vi.spyOn(document.documentElement, 'requestFullscreen').mockResolvedValue(undefined)
    service.setTarget(area)
    await service.enter()
    expect(areaSpy).toHaveBeenCalledTimes(1)
    service.setTarget(null)
    await service.enter()
    expect(rootSpy).toHaveBeenCalledTimes(1)
  })

  it('resolves false, not an error, when the browser refuses', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true })
    const service = new FullscreenService()
    vi.spyOn(document.documentElement, 'requestFullscreen').mockRejectedValue(new Error('denied'))
    expect(await service.enter()).toBe(false)
  })

  it('with no Fullscreen API (iPhone) it falls back to CSS and back again', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false })
    const service = new FullscreenService()
    const area = document.createElement('div')
    service.setTarget(area)
    await service.toggle()
    expect(area.classList.contains('rt-pseudo-fullscreen')).toBe(true)
    expect(service.isFullscreen()).toBe(true)
    await service.toggle()
    expect(area.classList.contains('rt-pseudo-fullscreen')).toBe(false)
    expect(service.isFullscreen()).toBe(false)
    service.setTarget(null)
    await service.toggle()
    expect(document.documentElement.hasAttribute('data-fullscreen-fallback')).toBe(true)
    await service.toggle()
    expect(document.documentElement.hasAttribute('data-fullscreen-fallback')).toBe(false)
  })
})
