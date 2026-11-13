import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import { activeDemoScenario, demoRecord } from '../mapping/demo-map'
import { recordStore } from '../storage/record-store'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'
import { MONTECITO_DEMO } from './sample-data-montecito'
import { SAMPLE_SCENARIOS, SampleDataService } from './sample-data.service'

/**
 * E-195: the Montecito sample scenario - the generated data (sample-data-montecito.ts, from
 * tools/regional/demo/make-montecito-demo.js) and the scenario loading from it. The generator
 * itself is tested in tools/regional/demo/test-make-montecito-demo.js.
 */
describe('Montecito sample scenario (E-195)', () => {
  const d = MONTECITO_DEMO

  describe('the generated data', () => {
    it('has the expected size: about 400 entries, 31 tactical calls, about 100 roster rows, 61 places', () => {
      expect(d.rows.length).toBe(417)
      expect(d.tacticalCalls.length).toBe(31)
      expect(d.rangers.length).toBeGreaterThanOrEqual(90)
      expect(d.rangers.length).toBeLessThanOrEqual(110)
      expect(d.places.length).toBe(61)
      expect(d.rows.filter((r) => r.f213).length).toBe(3) // E-283 ICS-213 messages
      expect(d.rows.filter((r) => r.rr).length).toBe(2) // E-283 resource requests
    })

    it('carries no fatality text anywhere (softened casualties only)', () => {
      const everything = JSON.stringify(d)
      expect(everything).not.toMatch(/deceased/i)
      expect(everything).not.toMatch(/coroner/i)
      expect(everything).not.toMatch(/fatalit|\bdead\b|\bdied\b|\bkilled\b/i)
      // The casualty rows are there, in the softened wording.
      expect(
        d.rows.filter((r) => /\bcritical\b/.test(r.notes) && r.status === 6).length
      ).toBeGreaterThan(0)
    })

    it('leaves out media and test rows, and names no real agency or outlet in the log', () => {
      expect(d.rows.some((r) => /https?:\/\//.test(r.notes))).toBe(false)
      expect(
        d.rows.some((r) => /\b(NWS|USGS|Wikipedia|Noozhawk|KSBY)\b/.test(r.notes))
      ).toBe(false)
      // A planted-test PII bait row carries a surname hyphen pair and a birth date; none is here.
      expect(d.rows.some((r) => /born \d/.test(r.notes))).toBe(false)
    })

    it('resolves every place, caller and To station', () => {
      const places = new Set(d.places.map((p) => p.id))
      const calls = new Set(d.rangers.map((r) => r.callsign))
      const tacticals = new Set(d.tacticalCalls.map((t) => t.name))
      expect(places.has(d.center.place)).toBe(true)
      d.rows.forEach((r) => {
        expect(places.has(r.place), `${r.id} place ${r.place}`).toBe(true)
        expect(calls.has(r.call), `${r.id} call ${r.call}`).toBe(true)
        if (r.to) expect(tacticals.has(r.to), `${r.id} to ${r.to}`).toBe(true)
        expect(r.scribe === 0 || r.scribe === 1).toBe(true)
      })
      d.tacticalCalls.forEach((t) => expect(calls.has(t.callsign), t.name).toBe(true))
    })

    it('puts every entry in the past, oldest first, with every status in use', () => {
      d.rows.forEach((r) => expect(r.ago, r.id).toBeGreaterThan(0))
      const ago = d.rows.map((r) => r.ago)
      expect(ago).toEqual([...ago].sort((a, b) => b - a))
      expect(new Set(d.rows.map((r) => r.status))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
    })

    it('invents everyone: 555-01xx phones, WZ0/KZ0 calls, DM- credentials, no duplicates', () => {
      d.rangers.forEach((r) => {
        expect(r.phone, r.fullName).toMatch(/^\d{3}-555-01\d\d$/)
        expect(r.callsign, r.fullName).toMatch(/^(WZ0|KZ0)[A-Z]{3}$/)
        expect(r.id).toMatch(/^DM-\d{4}$/)
      })
      expect(new Set(d.rangers.map((r) => r.callsign)).size).toBe(d.rangers.length)
      expect(new Set(d.rangers.map((r) => r.fullName)).size).toBe(d.rangers.length)
      expect(new Set(d.rangers.map((r) => r.phone)).size).toBe(d.rangers.length)
    })
  })

  describe('as a scenario', () => {
    beforeEach(async () => {
      localStorage.clear()
      await recordStore.resetForTests()
      TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    })

    afterEach(async () => {
      localStorage.clear()
      await recordStore.resetForTests()
    })

    it('is listed with the approved about text', () => {
      const option = SAMPLE_SCENARIOS.find((s) => s.id === 'montecito')
      expect(option, 'montecito listed').toBeTruthy()
      expect(option!.hint).toContain(
        'Modeled on the January 9, 2018 debris flows in Montecito, California. The people, teams and messages ' +
          'are invented; the scale, phases and problems follow the public record.'
      )
    })

    it('loads: roster, past-dated log, locations, tactical calls, op period, and the demo record', async () => {
      const mission = TestBed.inject(MissionService)
      const before = Date.now()
      await TestBed.inject(SampleDataService).loadSampleMission('montecito')

      const entries = TestBed.inject(RadioLogService).getCurrentRadioLog().logEntries
      expect(entries.length).toBe(d.rows.length)
      entries.forEach((e) => expect(e.date.getTime(), String(e.id)).toBeLessThan(before))
      expect(TestBed.inject(RangerService).rangers.length).toBe(d.rangers.length)
      expect(TestBed.inject(MissionLocationService).getCurrentLocations().length).toBe(
        d.places.length
      )

      expect(activeDemoScenario()).toBe('montecito')
      const record = demoRecord()!
      expect(record.reportIds.length).toBe(entries.length)
      expect(record.rangerUids.length).toBe(d.rangers.length)

      const s = mission.settings
      expect(s.missionMode).toBe('demo')
      expect(s.opPeriod).toBe('Op 2')
      expect(s.tacticalCalls?.length).toBe(31)
      // Centred over Montecito (Command Post 1).
      expect(s.defLat).toBeCloseTo(34.43, 1)
      expect(s.defLng).toBeCloseTo(-119.63, 1)
      // Op 2 began part-way through the log (the first entries belong to OP 0 and 1).
      expect(s.opPeriodStart!.getTime()).toBeGreaterThan(entries[0].date.getTime())
      expect(s.opPeriodStart!.getTime()).toBeLessThan(
        entries[entries.length - 1].date.getTime()
      )

      // Station-to-station traffic keeps its own To; "All units" has none.
      expect(entries.some((e) => e.toTactical === 'Command 1')).toBe(true)
      expect(entries.some((e) => e.toTactical === undefined)).toBe(true)
      // Tactical calls come through, and both scribes appear (the hand-over).
      expect(entries.some((e) => e.tacticalCall === 'Dispatch')).toBe(true)
      expect(new Set(entries.map((e) => e.operator)).size).toBe(2)

      // E-283: three entries are ICS-213 messages and two are resource requests, filled in.
      const messages = entries.filter((e) => e.generates213)
      expect(messages.length).toBe(3)
      messages.forEach((m) => {
        expect(m.subject213, String(m.id)).toBeTruthy()
        expect(m.message213, String(m.id)).toBeTruthy()
        expect(m.recipients213?.length, String(m.id)).toBe(1)
      })
      const requests = entries.filter((e) => e.rr213)
      expect(requests.length).toBe(2)
      requests.forEach((e) => {
        expect(e.rr213!.lines.length, String(e.id)).toBeGreaterThan(0)
        expect(e.rr213!.deliverTo, String(e.id)).toBeTruthy()
      })
    })
  })
})
