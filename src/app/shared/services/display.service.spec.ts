import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Location } from '@angular/common'
import { Router, provideRouter } from '@angular/router'

import { DISPLAY_PARAM, DisplayService } from './display.service'
import { FieldModeService } from './field-mode.service'
import { FullscreenService } from './fullscreen.service'

// E-314 / D-71: Display is a per-window, look-only state kept in the URL and nowhere else.
describe('DisplayService (E-314)', () => {
  const originalUrl = location.pathname + location.search + location.hash
  const settle = () => new Promise(resolve => setTimeout(resolve, 30))
  const page = {}
  /** The router's address (the test platform has its own mock location, not the page's). */
  const query = () => new URLSearchParams(TestBed.inject(Location).path().split('?')[1] ?? '')

  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', originalUrl)
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-display')
    history.replaceState(null, '', originalUrl)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  /** A service whose full screen request is a stub (a test page has no user gesture to give). */
  function make(offered = true): DisplayService {
    const fullscreen = TestBed.inject(FullscreenService)
    vi.spyOn(fullscreen, 'enter').mockResolvedValue(true)
    vi.spyOn(fullscreen, 'exit').mockResolvedValue(undefined)
    const service = TestBed.inject(DisplayService)
    if (offered) service.register(page)
    return service
  }

  it('is off by default, and Display does nothing on a page that does not offer it', async () => {
    const service = make(false)
    expect(service.active()).toBe(false)
    await service.enter()
    expect(service.active()).toBe(false)
  })

  it('entering sets data-display on the document and ?display=1 in the URL', async () => {
    const service = make()
    await service.enter()
    TestBed.tick()
    await settle()
    expect(service.active()).toBe(true)
    expect(document.documentElement.hasAttribute('data-display')).toBe(true)
    expect(query().get(DISPLAY_PARAM)).toBe('1')
  })

  it('leaving takes both back, and keeps any other query parameter', async () => {
    const service = make()
    await TestBed.inject(Router).navigateByUrl('/?keep=yes')
    await service.enter()
    await settle()
    expect(query().get('keep')).toBe('yes')
    expect(query().get(DISPLAY_PARAM)).toBe('1')
    await service.exit()
    TestBed.tick()
    await settle()
    expect(service.active()).toBe(false)
    expect(document.documentElement.hasAttribute('data-display')).toBe(false)
    expect(query().has(DISPLAY_PARAM)).toBe(false)
    expect(query().get('keep')).toBe('yes')
  })

  it('a reload with ?display=1 comes back in Display, with no full screen request', () => {
    history.replaceState(null, '', `${location.pathname}?display=1`)
    const service = make()
    TestBed.tick()
    expect(service.active()).toBe(true)
    expect(document.documentElement.hasAttribute('data-display')).toBe(true)
    expect(TestBed.inject(FullscreenService).enter).not.toHaveBeenCalled()
  })

  it('Esc leaves Display, but not while a field is being typed in', async () => {
    const service = make()
    await service.enter()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(service.active()).toBe(true)
    input.remove()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(service.active()).toBe(false)
  })

  it('leaving also leaves full screen, because Display asked for it', async () => {
    const service = make()
    await service.enter()
    await service.exit()
    expect(TestBed.inject(FullscreenService).exit).toHaveBeenCalledTimes(1)
  })

  it('a field phone is never offered Display', () => {
    const fieldMode = TestBed.inject(FieldModeService)
    fieldMode.enabled.set(true)
    const service = make()
    expect(service.offered()).toBe(false)
  })

  it('writes nothing to localStorage or sessionStorage on entering, marking or leaving', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const service = make()
    let cleared = 0
    service.setMarks({ count: signal(2), clear: () => { cleared++ } })
    await service.enter()
    expect(service.markCount()).toBe(2)
    await service.exit()
    await settle()
    expect(cleared).toBe(1)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('is no longer offered once the page in view goes', () => {
    const service = make()
    expect(service.offered()).toBe(true)
    service.unregister(page)
    expect(service.offered()).toBe(false)
  })
})
