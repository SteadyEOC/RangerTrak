import { TestBed } from '@angular/core/testing'

import { MissionType } from './mission.interface'
import { MissionService } from './mission.service'

/**
 * Characterization tests: pin MissionService's current localStorage-backed
 * behavior before the signals rewrite (PRIVATE-Roadmap.md Section 8/R4, Section 12
 * step 3). These assert what the service actually does today, not what it
 * should do.
 */
describe('MissionService', () => {
  const STORAGE_KEY = 'appSettings'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('construction / localStorage round-trip', () => {
    it('initializes hardcoded defaults when localStorage is empty', () => {
      const service = TestBed.inject(MissionService)

      expect(service.settings.defLat).toBe(47.4472)
      expect(service.settings.defLng).toBe(-122.4627)
      expect(service.settings.radioLogStatuses.length).toBe(7)
    })

    it('stamps settings.version from package.json rather than the hardcoded default', () => {
      const service = TestBed.inject(MissionService)
      expect(service.settings.version).not.toBe('0')
      expect(service.settings.version.length).toBeGreaterThan(0)
    })

    it('persists the initialized defaults to localStorage', () => {
      TestBed.inject(MissionService)
      const stored = localStorage.getItem(STORAGE_KEY)
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed.defLat).toBe(47.4472)
    })

    it('loads existing settings from localStorage when present and well-formed', () => {
      const custom = {
        schemaVersion: 4,
        settingsName: '',
        settingsDate: new Date(),
        mission: '99',
        event: 'Test Event',
        eventNotes: '',
        opPeriod: '',
        opPeriodStart: new Date(),
        opPeriodEnd: new Date(),
        application: 'RangerTrak',
        version: '9.9.9',
        debugMode: false,
        defLat: 1.111,
        defLng: 2.222,
        allowManualPinDrops: false,
        leaflet: {
          defZoom: 1,
          markerScheme: '',
          overviewDifference: 1,
          overviewMinZoom: 1,
          overviewMaxZoom: 1,
        },
        maplibre: {
          defZoom: 1,
          markerScheme: '',
          overviewDifference: 1,
          overviewMinZoom: 1,
          overviewMaxZoom: 1,
        },
        imageDirectory: './assets/imgs/',
        defRadioLogStatus: 0,
        radioLogStatuses: [],
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

      const service = TestBed.inject(MissionService)

      // Current behavior: everything from localStorage is preserved except
      // `version`, which is always overwritten from package.json after load.
      expect(service.settings.mission).toBe('99')
      expect(service.settings.defLat).toBe(1.111)
      expect(service.settings.event).toBe('Test Event')
      expect(service.settings.version).not.toBe('9.9.9')
    })

    it('falls back to hardcoded defaults when localStorage JSON lacks the "defLat" marker', () => {
      // The current load check is a naive substring test for "defLat" in the raw stored
      // string, not real schema validation. It deliberately does NOT check for
      // "schemaVersion" - a genuine pre-Sprint-E (v0) object has no schemaVersion at all,
      // and migrateMission() treats that absence as "version 0" and migrates it forward,
      // so requiring the key here would reject the exact shape migration exists to handle.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mission: '42' }))

      const service = TestBed.inject(MissionService)

      expect(service.settings.defLat).toBe(47.4472)
      expect(service.settings.mission).toBe('')
    })

    it('loads a v0 object with no schemaVersion at all, migrating it forward rather than rejecting it', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mission: 'v0-mission', defLat: 9.999, defLng: 8.888 })
      )

      const service = TestBed.inject(MissionService)

      expect(service.settings.mission).toBe('v0-mission')
      expect(service.settings.defLat).toBe(9.999)
      expect(service.settings.schemaVersion).toBeGreaterThanOrEqual(1)
    })

    it('preserves unparseable localStorage content under a "-BAD" key and falls back to defaults', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json, has defLat though')

      const service = TestBed.inject(MissionService)

      expect(service.settings.defLat).toBe(47.4472)
      expect(localStorage.getItem(STORAGE_KEY + '-BAD')).toContain('defLat')
    })
  })

  describe('updateMission', () => {
    it('persists the new settings to localStorage and publishes to subscribers', () => {
      const service = TestBed.inject(MissionService)
      let latest: MissionType | undefined
      service.getMissionObserver().subscribe((s) => (latest = s))

      const updated = { ...service.settings, mission: 'Mission 7' }
      service.updateMission(updated)

      expect(service.settings.mission).toBe('Mission 7')
      expect(latest?.mission).toBe('Mission 7')
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(stored.mission).toBe('Mission 7')
    })
  })

  describe('ResetDefaults', () => {
    it('restores hardcoded defaults and persists them', () => {
      const service = TestBed.inject(MissionService)
      service.updateMission({ ...service.settings, mission: 'Something Else' })

      const result = service.ResetDefaults()

      expect(result.defLat).toBe(47.4472)
      expect(service.settings.mission).toBe('')
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(stored.defLat).toBe(47.4472)
    })
  })
})
