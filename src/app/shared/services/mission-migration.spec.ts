import { MissionType } from './mission.interface'
import {
  DEFAULT_RADIO_LOG_STATUSES, MISSION_SCHEMA_VERSION, migrateMission
} from './mission-migration'
import { statusColorMeetsAA, statusColorValue, statusInkValue } from './status-color'

/**
 * migrateMission() is deliberately pure, so these are plain function tests - no TestBed, no
 * browser. The point of the mechanism is that settings written by an older build can arrive
 * at ANY time (localStorage on load, or a mission export months later), so the cases that
 * matter are the awkward ones: absent version, custom colors, reordered/renamed statuses.
 */
describe('migrateMission', () => {

  /** A v0 (pre-Sprint-E) settings object, with the CSS named colors as originally shipped. */
  function v0Settings(): MissionType {
    return {
      settingsName: '', settingsDate: new Date(0),
      mission: 'M1', event: '', eventNotes: '', opPeriod: '',
      opPeriodStart: new Date(0), opPeriodEnd: new Date(0),
      application: 'RangerTrak', version: '0.15.8', debugMode: false,
      defLat: 47.4472, defLng: -122.4627,
      allowManualPinDrops: false, googleGeocodingApiKey: '',
      google: { defZoom: 17, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 },
      leaflet: { defZoom: 17, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 },
      imageDirectory: './assets/imgs/', defRadioLogStatus: 0,
      radioLogStatuses: [
        { status: 'Normal', color: 'LightYellow', icon: 'a.png' },
        { status: 'Location Report', color: 'Aquamarine', icon: 'b.png' },
        { status: 'Evidence Report', color: 'DarkGoldenrod', icon: 'c.png' },
        { status: 'Need Rest/Food', color: 'Chartreuse', icon: 'd.png' },
        { status: 'Incident Check-in', color: 'Silver', icon: 'e.png' },
        { status: 'Incident Check-out', color: 'DimGray', icon: 'f.png' },
        { status: 'Urgent', color: 'Crimson', icon: 'g.png' },
      ],
    } as unknown as MissionType
  }

  /**
   * E-118 regression guard. `checkInIntervalMin` is an additive-only field, so it relies
   * entirely on backfillMissingFields rather than a schema bump - exactly the arrangement
   * that has twice shipped a Settings page broken for returning users. These prove the
   * returning-user path, not just the fresh-install one.
   */
  describe('checkInIntervalMin backfill (E-118)', () => {
    it('hands the default to settings saved before the field existed', () => {
      const stored = v0Settings()
      expect('checkInIntervalMin' in stored).withContext('precondition: field absent').toBe(false)

      const out = migrateMission(stored, defaultsWithInterval(30))
      expect(out.checkInIntervalMin).toBe(30)
    })

    it('does not overwrite an interval the user has already chosen', () => {
      const stored = { ...v0Settings(), checkInIntervalMin: 15 } as MissionType
      expect(migrateMission(stored, defaultsWithInterval(30)).checkInIntervalMin).toBe(15)
    })

    it('preserves a deliberate 0 (escalation off) rather than treating it as missing', () => {
      const stored = { ...v0Settings(), checkInIntervalMin: 0 } as MissionType
      expect(migrateMission(stored, defaultsWithInterval(30)).checkInIntervalMin).toBe(0)
    })

    /** Defaults shaped like initMission()'s output, which is what production passes in. */
    function defaultsWithInterval(checkInIntervalMin: number): MissionType {
      return { ...v0Settings(), checkInIntervalMin } as MissionType
    }
  })

  it('stamps the current schema version on settings that had none', () => {
    const out = migrateMission(v0Settings())
    expect(out.schemaVersion).toBe(MISSION_SCHEMA_VERSION)
  })

  it('converts every legacy default color to its semantic key', () => {
    const out = migrateMission(v0Settings())
    expect(out.radioLogStatuses.map(s => s.color)).toEqual([
      'normal', 'location-report', 'evidence-report', 'need-rest-food',
      'incident-check-in', 'incident-check-out', 'urgent',
    ])
  })

  it('preserves status order, because defRadioLogStatus is an index into it', () => {
    const before = v0Settings()
    const out = migrateMission(before)
    expect(out.radioLogStatuses.map(s => s.status))
      .toEqual(before.radioLogStatuses.map(s => s.status))
    // The default status must still be the one it was before the migration ran.
    expect(out.radioLogStatuses[out.defRadioLogStatus].status).toBe('Normal')
  })

  it('leaves a color the user deliberately customized alone', () => {
    const input = v0Settings()
    input.radioLogStatuses[6].color = '#FF00FF' // user recolored Urgent
    const out = migrateMission(input)
    expect(out.radioLogStatuses[6].color).toBe('#FF00FF')
    // ...while its untouched neighbors still migrate.
    expect(out.radioLogStatuses[5].color).toBe('incident-check-out')
  })

  it('does not rewrite a status wearing another status\'s old default color', () => {
    // Matching on color alone would turn this into 'normal' and silently change its meaning.
    const input = v0Settings()
    input.radioLogStatuses[6].color = 'LightYellow' // Urgent, but yellow, on purpose
    const out = migrateMission(input)
    expect(out.radioLogStatuses[6].color).toBe('LightYellow')
  })

  it('is idempotent - migrating twice changes nothing further', () => {
    const once = migrateMission(v0Settings())
    const twice = migrateMission(once)
    expect(twice).toEqual(once)
  })

  it('does not mutate its argument', () => {
    const input = v0Settings()
    migrateMission(input)
    expect(input.radioLogStatuses[0].color).toBe('LightYellow')
    expect((input as { schemaVersion?: number }).schemaVersion).toBeUndefined()
  })

  it('leaves settings from a NEWER build alone rather than downgrading them', () => {
    const future = { ...v0Settings(), schemaVersion: MISSION_SCHEMA_VERSION + 99 }
    const out = migrateMission(future)
    expect(out.schemaVersion).toBe(MISSION_SCHEMA_VERSION + 99)
    expect(out.radioLogStatuses[0].color).toBe('LightYellow') // untouched, not "migrated"
  })

  it('falls back to the shipped defaults when statuses are missing entirely', () => {
    const broken = { ...v0Settings(), radioLogStatuses: undefined } as unknown as MissionType
    const out = migrateMission(broken)
    expect(out.radioLogStatuses).toEqual([...DEFAULT_RADIO_LOG_STATUSES])
  })

  // BUG-3 (2026-08-19): settings saved before googleGeocodingApiKey existed had no such key,
  // and [formField]="form.googleGeocodingApiKey" cannot build a field for a model property
  // that is absent - it threw on every change-detection pass. This backfill is the fix.
  describe('backfilling fields added after a settings object was saved (BUG-3)', () => {
    function defaults(): MissionType {
      return { ...v0Settings(), googleGeocodingApiKey: 'DEFAULT-KEY', event: 'Default Event' }
    }

    it('adds a top-level key the stored object never had, from the supplied defaults', () => {
      const stored = v0Settings() as unknown as Record<string, unknown>
      delete stored['googleGeocodingApiKey']
      const out = migrateMission(stored as unknown as MissionType, defaults())
      expect(out.googleGeocodingApiKey).toBe('DEFAULT-KEY')
    })

    it('does not overwrite a value the stored object already has, even an empty string', () => {
      const stored = { ...v0Settings(), googleGeocodingApiKey: 'USERS-OWN-KEY' }
      const out = migrateMission(stored, defaults())
      expect(out.googleGeocodingApiKey).toBe('USERS-OWN-KEY')

      const emptyOnPurpose = { ...v0Settings(), event: '' }
      const out2 = migrateMission(emptyOnPurpose, defaults())
      expect(out2.event).toBe('') // '' is a real, deliberate value - not "missing"
    })

    it('backfills one level into nested objects like leaflet/google', () => {
      const stored = v0Settings() as unknown as Record<string, unknown>
      delete (stored['leaflet'] as Record<string, unknown>)['markerScheme']
      const withDefaults = defaults()
      ;(withDefaults as unknown as Record<string, unknown>)['leaflet'] =
        { ...withDefaults.leaflet, markerScheme: 'default-scheme' }

      const out = migrateMission(stored as unknown as MissionType, withDefaults)
      expect(out.leaflet.markerScheme).toBe('default-scheme')
      expect(out.leaflet.defZoom).toBe(17) // the user's existing sibling value is untouched
    })

    it('does nothing when no defaults are supplied - callers must opt in deliberately', () => {
      const stored = v0Settings() as unknown as Record<string, unknown>
      delete stored['googleGeocodingApiKey']
      const out = migrateMission(stored as unknown as MissionType)
      expect('googleGeocodingApiKey' in out).toBe(false)
    })

    // Recurrence (2026-08-20), confirmed live on 0.16.7 from a real user's exported log:
    // Sprint H added six new MissionType fields (showDD/showDDM/showDMS/showMGRS/showUTM/
    // showMaidenhead) without bumping MISSION_SCHEMA_VERSION. Every user already stamped at
    // version 2 - i.e. everyone who had opened the app before Sprint H shipped - hit
    // `this.field() is not a function` on Settings' six new checkboxes, every change-
    // detection pass, because the version gate skipped backfillMissingFields entirely for
    // anyone already "current". This is the exact scenario: an object already at the
    // CURRENT schema version, still missing a field the live MissionType now declares.
    it('backfills a field even when the stored object is already at the current schema version', () => {
      const alreadyCurrent = { ...v0Settings(), schemaVersion: MISSION_SCHEMA_VERSION } as unknown as Record<string, unknown>
      delete alreadyCurrent['event'] // stands in for a field added after this user's last save
      const out = migrateMission(alreadyCurrent as unknown as MissionType, defaults())
      expect(out.event).toBe('Default Event')
      expect(out.schemaVersion).toBe(MISSION_SCHEMA_VERSION) // not bumped further
    })
  })

  describe('drop dead w3wLocale/defPlusCode fields (E-89/E-90, schemaVersion 3 -> 4)', () => {
    it('removes both dead fields from a returning user\'s stored object', () => {
      const stored = {
        ...v0Settings(), schemaVersion: 3, w3wLocale: 'Vashon, WA', defPlusCode: '84VVCGWP+VW',
      } as unknown as Record<string, unknown>

      const out = migrateMission(stored as unknown as MissionType) as unknown as Record<string, unknown>

      expect('w3wLocale' in out).toBe(false)
      expect('defPlusCode' in out).toBe(false)
      expect(out['schemaVersion']).toBe(MISSION_SCHEMA_VERSION)
    })

    it('leaves an object with neither key alone rather than erroring', () => {
      const stored = v0Settings() as unknown as Record<string, unknown>
      const out = migrateMission(stored as unknown as MissionType) as unknown as Record<string, unknown>
      expect('w3wLocale' in out).toBe(false)
      expect('defPlusCode' in out).toBe(false)
    })

    it('is idempotent - an already-migrated object is untouched by a second pass', () => {
      const alreadyCurrent = { ...v0Settings(), schemaVersion: MISSION_SCHEMA_VERSION } as unknown as Record<string, unknown>
      const once = migrateMission(alreadyCurrent as unknown as MissionType)
      const twice = migrateMission(once)
      expect(twice).toEqual(once)
    })
  })

  describe('google -> maplibre rename (E-70, schemaVersion 2 -> 3)', () => {
    it('renames a returning user\'s stored `google` block to `maplibre`, preserving every value', () => {
      const stored = {
        ...v0Settings(), schemaVersion: 2,
        google: { defZoom: 12, markerScheme: 'custom', overviewDifference: 4, overviewMinZoom: 3, overviewMaxZoom: 20 },
      } as unknown as Record<string, unknown>
      delete stored['leaflet'] // irrelevant to this migration - present in a real object

      const out = migrateMission(stored as unknown as MissionType)
      const outAsRecord = out as unknown as Record<string, unknown>

      expect(outAsRecord['maplibre']).toEqual({
        defZoom: 12, markerScheme: 'custom', overviewDifference: 4, overviewMinZoom: 3, overviewMaxZoom: 20
      })
      expect('google' in outAsRecord).toBe(false)
      expect(out.schemaVersion).toBe(MISSION_SCHEMA_VERSION)
    })

    it('leaves an object with no `google` key alone rather than inventing one', () => {
      const stored = v0Settings() as unknown as Record<string, unknown>
      delete stored['google']
      const out = migrateMission(stored as unknown as MissionType) as unknown as Record<string, unknown>
      expect('google' in out).toBe(false)
      expect('maplibre' in out).toBe(false) // no defaults supplied, so nothing backfills it either
    })

    it('is idempotent - an already-renamed object is untouched by a second pass', () => {
      const alreadyRenamed = {
        ...v0Settings(), schemaVersion: MISSION_SCHEMA_VERSION,
        maplibre: { defZoom: 12, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 },
      } as unknown as Record<string, unknown>
      delete alreadyRenamed['google']

      const out = migrateMission(alreadyRenamed as unknown as MissionType) as unknown as Record<string, unknown>
      expect(out['maplibre']).toEqual({ defZoom: 12, markerScheme: '', overviewDifference: 5, overviewMinZoom: 5, overviewMaxZoom: 16 })
    })
  })
})

describe('status colors', () => {
  it('resolves the shipped defaults to token references, not raw colors', () => {
    for (const s of DEFAULT_RADIO_LOG_STATUSES) {
      expect(statusColorValue(s.color)).toBe(`var(--rt-status-${s.color})`)
      expect(statusInkValue(s.color)).toBe('var(--rt-status-ink)')
    }
  })

  it('passes a custom color through untouched', () => {
    expect(statusColorValue('#FF00FF')).toBe('#FF00FF')
  })

  it('picks readable ink for custom colors at both ends of the range', () => {
    expect(statusInkValue('#000080')).toBe('#FFFFFF') // dark navy -> white text
    expect(statusInkValue('#FFFF00')).toBe('#111111') // bright yellow -> near-black text
  })

  it('flags a custom color that cannot carry readable text', () => {
    // The band that fails against BOTH inks is narrower than "mid grey" intuition suggests:
    // #787878 peaks at 4.42:1 (white 4.42, near-black 4.28) and fails, while #7c7c7c already
    // clears it at 4.52:1 against near-black. Worth pinning precisely - an earlier draft of
    // this test assumed #808080 failed, and it does not (4.78:1 on near-black).
    expect(statusColorMeetsAA('#787878')).toBe(false)
    expect(statusColorMeetsAA('#7c7c7c')).toBe(true)
    expect(statusColorMeetsAA('#000080')).toBe(true)
  })

  it('treats every built-in key as accessible without measuring', () => {
    for (const s of DEFAULT_RADIO_LOG_STATUSES) {
      expect(statusColorMeetsAA(s.color)).toBe(true)
    }
  })
})

/**
 * The 0.90.5 operational-period clamp bug. Settings reach every consumer through
 * migrateMission(), and every path into it is JSON.parse - so the four Date-typed fields
 * arrive as ISO strings while TypeScript still believes they are Dates. Nothing threw; the
 * clamp that stops an op period ending before it starts just silently stopped firing,
 * because `Date < string` coerces to NaN and NaN comparisons are false in both directions.
 *
 * These tests deliberately go through JSON.parse(JSON.stringify(...)) rather than
 * hand-writing string literals, so they exercise the actual round-trip that causes it.
 */
describe('migrateMission date rehydration', () => {

  function roundTripped(overrides: Partial<MissionType> = {}): MissionType {
    const live: MissionType = {
      ...JSON.parse(JSON.stringify({})),
      settingsName: '', settingsDate: new Date('2026-08-31T12:00:00.000Z'),
      mission: 'M1', event: '', eventNotes: '', opPeriod: '',
      opPeriodStart: new Date('2026-09-01T20:00:00.000Z'),
      opPeriodEnd: new Date('2026-09-02T08:00:00.000Z'),
      schemaVersion: MISSION_SCHEMA_VERSION,
      ...overrides,
    } as MissionType
    // Exactly what localStorage / a backup file / a Prep import does to it.
    return JSON.parse(JSON.stringify(live)) as MissionType
  }

  it('returns real Dates for fields a JSON round-trip turned into strings', () => {
    const stored = roundTripped()
    expect(typeof (stored.opPeriodStart as unknown)).toBe('string') // precondition

    const migrated = migrateMission(stored)

    expect(migrated.opPeriodStart instanceof Date).toBe(true)
    expect(migrated.opPeriodEnd instanceof Date).toBe(true)
    expect(migrated.settingsDate instanceof Date).toBe(true)
  })

  it('preserves the instant exactly, not just the type', () => {
    const migrated = migrateMission(roundTripped())
    expect(migrated.opPeriodStart.toISOString()).toBe('2026-09-01T20:00:00.000Z')
    expect(migrated.opPeriodEnd.toISOString()).toBe('2026-09-02T08:00:00.000Z')
  })

  it('restores ordering comparisons, which is the actual bug', () => {
    const migrated = migrateMission(roundTripped())
    const earlierEnd = new Date('2026-09-01T08:00:00.000Z') // 12h BEFORE the start

    // This is the exact expression MissionComponent's clamp evaluates. Before the fix it
    // was Date < string -> NaN -> false, so the clamp never fired.
    expect(earlierEnd < migrated.opPeriodStart).toBe(true)
  })

  it('leaves an already-Date value untouched', () => {
    const live = roundTripped()
    ;(live as unknown as Record<string, unknown>)['opPeriodStart'] = new Date('2026-09-01T20:00:00.000Z')
    const migrated = migrateMission(live)
    expect(migrated.opPeriodStart.toISOString()).toBe('2026-09-01T20:00:00.000Z')
  })

  it('leaves an unparseable value alone rather than inventing a plausible date', () => {
    const live = roundTripped()
    ;(live as unknown as Record<string, unknown>)['opPeriodEnd'] = 'not a date at all'
    const migrated = migrateMission(live)
    // Surfacing bad data beats quietly substituting new Date() into an op period.
    expect(migrated.opPeriodEnd as unknown).toBe('not a date at all')
  })

  it('tolerates a missing optional date field', () => {
    const migrated = migrateMission(roundTripped())
    expect(migrated.lastPrintedAt).toBeUndefined()
  })
})
