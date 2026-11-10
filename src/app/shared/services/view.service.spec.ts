import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import { recordStore } from '../storage/record-store'
import { MissionService } from './mission.service'
import { ViewService } from './view.service'

// E-207 / D-62. ViewService constructs MissionService, RadioLogService and friends, so each case
// starts from a wiped device, as the other service specs do.
describe('ViewService (E-207)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  /** Gives the device a named mission, so it no longer counts as an untouched install. */
  function giveDeviceData(): void {
    const missions = TestBed.inject(MissionService)
    missions.updateMission({ ...missions.settings, mission: 'Search at Dockton' })
  }

  it('a new install starts in Simple and stores it at once', () => {
    const view = TestBed.inject(ViewService)
    expect(view.view()).toBe('simple')
    expect(view.source()).toBe('default')
    expect(localStorage.getItem('rt-view')).toBe('simple')
    expect(localStorage.getItem('rt-view-source')).toBe('default')
  })

  it('a device that already holds mission data starts in Full (upgrade)', () => {
    giveDeviceData()
    const view = TestBed.inject(ViewService)
    expect(view.view()).toBe('full')
    expect(view.source()).toBe('upgrade')
    expect(localStorage.getItem('rt-view')).toBe('full')
  })

  it('does not flip later as data arrives', () => {
    const view = TestBed.inject(ViewService)
    giveDeviceData()
    expect(view.view()).toBe('simple')
    expect(localStorage.getItem('rt-view')).toBe('simple')
  })

  it("reads a stored view back, and treats a missing source as the person's own", () => {
    localStorage.setItem('rt-view', 'full')
    const view = TestBed.inject(ViewService)
    expect(view.view()).toBe('full')
    expect(view.source()).toBe('user')
  })

  it("the person's switch stores the view with source user", () => {
    const view = TestBed.inject(ViewService)
    view.setView('full')
    expect(view.view()).toBe('full')
    expect(localStorage.getItem('rt-view')).toBe('full')
    expect(localStorage.getItem('rt-view-source')).toBe('user')
  })

  describe("a Setup file's suggestion", () => {
    it('applies to a device on its default view, once', () => {
      const view = TestBed.inject(ViewService)
      view.suggest('full')
      expect(view.view()).toBe('full')
      expect(view.source()).toBe('setup')
      view.suggest('simple')
      expect(view.view()).toBe('full')
    })

    it("never overrides the person's own choice", () => {
      const view = TestBed.inject(ViewService)
      view.setView('simple')
      view.suggest('full')
      expect(view.view()).toBe('simple')
      expect(view.source()).toBe('user')
    })

    it('applies to an upgraded device that has not chosen yet', () => {
      giveDeviceData()
      const view = TestBed.inject(ViewService)
      view.suggest('simple')
      expect(view.view()).toBe('simple')
      expect(view.source()).toBe('setup')
    })

    it('ignores an unknown value', () => {
      const view = TestBed.inject(ViewService)
      view.suggest('expert')
      view.suggest(undefined)
      expect(view.view()).toBe('simple')
      expect(view.source()).toBe('default')
    })
  })

  describe('isShown', () => {
    it('hides advanced controls in Simple and shows them in Full', () => {
      const view = TestBed.inject(ViewService)
      expect(view.isShown('tactical-calls')).toBe(false)
      view.setView('full')
      expect(view.isShown('tactical-calls')).toBe(true)
    })

    it('shows a control the mission uses, even in Simple', () => {
      const missions = TestBed.inject(MissionService)
      const view = TestBed.inject(ViewService)
      expect(view.isShown('tactical-calls')).toBe(false)
      missions.updateMission({
        ...missions.settings,
        tacticalCalls: [{ name: 'Vashon EOC' }],
      })
      expect(view.view()).toBe('simple')
      expect(view.isShown('tactical-calls')).toBe(true)
      expect(view.isShown('stations')).toBe(true)
    })

    it('hiding changes nothing: a mission setting survives a switch to Simple and back', () => {
      const missions = TestBed.inject(MissionService)
      const view = TestBed.inject(ViewService)
      view.setView('full')
      missions.updateMission({ ...missions.settings, googleGeocodingApiKey: 'k' })
      view.setView('simple')
      expect(missions.settings.googleGeocodingApiKey).toBe('k')
      expect(view.isShown('maps')).toBe(true)
    })

    it('a page can add a fact it alone knows, and can only ever show more', () => {
      const view = TestBed.inject(ViewService)
      expect(view.isShown('layers-panel')).toBe(false)
      expect(view.isShown('layers-panel', { layerCount: 2 })).toBe(true)
      expect(view.isShown('attachments', { attachmentCount: 1 })).toBe(true)
      expect(view.isShown('attachments', { attachmentCount: 0 })).toBe(false)
    })
  })

  describe('when storage throws', () => {
    it('still works for the session, and does not throw', () => {
      const set = Storage.prototype.setItem
      const get = Storage.prototype.getItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        k: string,
        v: string
      ) {
        if (k.startsWith('rt-view')) throw new Error('quota')
        return set.call(this, k, v)
      })
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
        this: Storage,
        k: string
      ) {
        if (k.startsWith('rt-view')) throw new Error('blocked')
        return get.call(this, k)
      })
      const view = TestBed.inject(ViewService)
      expect(view.view()).toBe('simple')
      view.setView('full')
      expect(view.view()).toBe('full')
      expect(view.isShown('statuses')).toBe(true)
    })
  })
})
