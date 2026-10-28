import { ADVANCED_FEATURES, ViewContext, applySuggestedView, initialView, isAdvanced, isShown } from './view'

describe('Simple view and Full view (E-207, D-62)', () => {
  /** A blank mission: nothing in use. */
  const blank: ViewContext = {
    statusesCustomised: false, locationCategoriesCustomised: false, locationCount: 0,
    mapSettingsCustomised: false, recipientsCustomised: false, tacticalCallCount: 0, boardInUse: false,
    attachmentCount: 0, encryptionOn: false, fieldMode: false,
    nonDefaultSourceCount: 0, toStationCount: 0, evidenceLocationCount: 0, layerCount: 0,
    mapEngineIsAlternative: false, mapExtraLayersOn: false,
    setupFileAsked: false, activityLineCount: 0,
  }

  describe('ADVANCED_FEATURES', () => {
    it('has unique kebab-case ids', () => {
      const ids = ADVANCED_FEATURES.map(f => f.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    })

    it('hides every feature in Simple on a blank mission', () => {
      for (const f of ADVANCED_FEATURES) expect(isShown(f.id, 'simple', blank)).withContext(f.id).toBeFalse()
    })

    it('shows every feature in Full, whatever the mission holds', () => {
      for (const f of ADVANCED_FEATURES) expect(isShown(f.id, 'full', blank)).withContext(f.id).toBeTrue()
    })
  })

  describe('isShown in Simple view: shown while the mission uses it', () => {
    const cases: { id: string, ctx: Partial<ViewContext> }[] = [
      { id: 'statuses', ctx: { statusesCustomised: true } },
      { id: 'location-categories', ctx: { locationCategoriesCustomised: true } },
      { id: 'locations-list', ctx: { locationCount: 1 } },
      { id: 'maps', ctx: { mapSettingsCustomised: true } },
      { id: 'recipients213', ctx: { recipientsCustomised: true } },
      { id: 'tactical-calls', ctx: { tacticalCallCount: 2 } },
      { id: 'board', ctx: { boardInUse: true } },
      { id: 'attachments-budget', ctx: { attachmentCount: 1 } },
      { id: 'device-encryption', ctx: { encryptionOn: true } },
      { id: 'advanced-debug', ctx: { fieldMode: true } },
      { id: 'field-phone', ctx: { fieldMode: true } },
      { id: 'stations', ctx: { tacticalCallCount: 1 } },
      { id: 'stations', ctx: { toStationCount: 1 } },
      { id: 'source', ctx: { nonDefaultSourceCount: 1 } },
      { id: 'evidence-location', ctx: { evidenceLocationCount: 1 } },
      { id: 'attachments', ctx: { attachmentCount: 3 } },
      { id: 'places-import', ctx: { locationCount: 4 } },
      { id: 'maplibre', ctx: { mapEngineIsAlternative: true } },
      { id: 'map-layers-extra', ctx: { mapExtraLayersOn: true } },
      { id: 'layers-panel', ctx: { layerCount: 2 } },
      { id: 'after-action', ctx: { activityLineCount: 1 } },
    ]
    for (const c of cases) {
      it(`${c.id} shows when ${JSON.stringify(c.ctx)}`, () => {
        expect(isShown(c.id, 'simple', { ...blank, ...c.ctx })).toBeTrue()
      })
    }

    it('a single loaded layer does not open the layers panel', () => {
      expect(isShown('layers-panel', 'simple', { ...blank, layerCount: 1 })).toBeFalse()
    })

    it('the Setup file shows only when asked for by link', () => {
      expect(isShown('setup-file', 'simple', { ...blank, attachmentCount: 9, locationCount: 9 })).toBeFalse()
      expect(isShown('setup-file', 'simple', { ...blank, setupFileAsked: true })).toBeTrue()
    })
  })

  it('shows an unknown id in either view', () => {
    expect(isShown('no-such-feature', 'simple', blank)).toBeTrue()
    expect(isShown('no-such-feature', 'full', blank)).toBeTrue()
  })

  describe('isAdvanced (the marker)', () => {
    it('marks an advanced feature in Full view only', () => {
      expect(isAdvanced('tactical-calls', 'full')).toBeTrue()
      expect(isAdvanced('tactical-calls', 'simple')).toBeFalse()
    })

    it('never marks an unknown id', () => {
      expect(isAdvanced('no-such-feature', 'full')).toBeFalse()
    })
  })

  describe('initialView (the upgrade rule)', () => {
    it('a new install starts in Simple', () => {
      expect(initialView({ stored: null, hasMissionData: false })).toEqual({ view: 'simple', source: 'default' })
    })

    it('a device that already holds mission data starts in Full', () => {
      expect(initialView({ stored: null, hasMissionData: true })).toEqual({ view: 'full', source: 'upgrade' })
    })

    it('a stored choice is never replaced', () => {
      expect(initialView({ stored: 'simple', hasMissionData: true })).toBeNull()
      expect(initialView({ stored: 'full', hasMissionData: false })).toBeNull()
    })
  })

  describe('applySuggestedView (the Setup file rule)', () => {
    it('applies to a device on its default view and records setup', () => {
      expect(applySuggestedView({ suggested: 'full', source: 'default' })).toEqual({ view: 'full', source: 'setup' })
    })

    it('applies to an upgraded device that has not chosen yet', () => {
      expect(applySuggestedView({ suggested: 'simple', source: 'upgrade' })).toEqual({ view: 'simple', source: 'setup' })
    })

    it('is applied once: never over an earlier suggestion', () => {
      expect(applySuggestedView({ suggested: 'full', source: 'setup' })).toBeNull()
    })

    it('never overrides the person\'s own choice', () => {
      expect(applySuggestedView({ suggested: 'simple', source: 'user' })).toBeNull()
    })

    it('ignores a missing or unknown suggestion', () => {
      expect(applySuggestedView({ suggested: undefined, source: 'default' })).toBeNull()
      expect(applySuggestedView({ suggested: 'expert', source: 'default' })).toBeNull()
      expect(applySuggestedView({ suggested: 3, source: 'default' })).toBeNull()
    })

    it('ignores a device with no recorded source', () => {
      expect(applySuggestedView({ suggested: 'simple', source: null })).toBeNull()
    })
  })
})
