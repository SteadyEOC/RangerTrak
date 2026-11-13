import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import { activeDemoScenario, demoRecord } from '../mapping/demo-map'
import { recordStore } from '../storage/record-store'
import { MissionLocationService } from './mission-location.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'
import { OSO_DEMO } from './sample-data-oso'
import { SAMPLE_SCENARIOS, SampleDataService } from './sample-data.service'

/**
 * E-195: the Oso sample scenario - the generated data (sample-data-oso.ts, from
 * tools/regional/demo/make-oso-demo.js) and the scenario loading from it. The generator itself
 * is tested in tools/regional/demo/test-make-oso-demo.js. Built like the Montecito spec, plus
 * the ICS-213 messages that Montecito did not have.
 */
describe('Oso sample scenario (E-195)', () => {
  const d = OSO_DEMO
  const messageRows = d.rows.filter((r) => r.f213)

  describe('the generated data', () => {
    it('has the expected size: 510 entries (51 ICS-213, 3 ICS-213RR), 40 tactical calls, 128 roster rows, 73 places', () => {
      expect(d.rows.length).toBe(510)
      expect(messageRows.length).toBe(51)
      expect(d.rows.filter((r) => r.rr).length).toBe(3)
      expect(d.tacticalCalls.length).toBe(40)
      expect(d.rangers.length).toBeGreaterThanOrEqual(128)
      expect(d.rangers.length).toBeLessThanOrEqual(150)
      expect(d.places.length).toBe(73)
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
        d.rows.some((r) =>
          /\b(NWS|USGS|FEMA|OSHA|ARRL|WSDOT|Snohomish|Flickr|Wikipedia)\b/.test(r.notes)
        )
      ).toBe(false)
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

    it('puts every entry in the past, oldest first, with six of the seven statuses in use', () => {
      d.rows.forEach((r) => expect(r.ago, r.id).toBeGreaterThan(0))
      const ago = d.rows.map((r) => r.ago)
      expect(ago).toEqual([...ago].sort((a, b) => b - a))
      // No Oso row reads as a Location Report (status 1: the generator's rule needs "contacted" or
      // "need extraction" wording, which this scenario does not use), so six of the seven appear.
      expect(new Set(d.rows.map((r) => r.status))).toEqual(new Set([0, 2, 3, 4, 5, 6]))
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

    it('gives every ICS-213 row a subject, a message and an addressee', () => {
      messageRows.forEach((r) => {
        expect(r.f213!.subject, r.id).not.toBe('')
        expect(r.f213!.message, r.id).not.toBe('')
        expect(r.f213!.to, r.id).not.toBe('')
        expect(r.f213!.message, r.id).not.toMatch(/^ICS-213 message|Reply:/)
      })
    })

    it('uses the new place types, and Command Post West is the first place', () => {
      const types = new Set(d.places.map((p) => p.type))
      ;['Search Division', 'Decon', 'River Gauge', 'Command Post', 'Helispot'].forEach(
        (t) => expect(types.has(t), t).toBe(true)
      )
      expect(d.places.filter((p) => p.type === 'Command Post').length).toBe(2)
      expect(d.center.place).toBe(d.places[0].id)
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
      const option = SAMPLE_SCENARIOS.find((s) => s.id === 'oso')
      expect(option, 'oso listed').toBeTruthy()
      expect(option!.hint).toContain(
        'Modeled on the March 22, 2014 SR 530 landslide near Oso, Washington. The people, teams and messages ' +
          'are invented; the scale, phases and problems follow the public record.'
      )
    })

    it('loads: roster, past-dated log, ICS-213 messages, locations, tactical calls, op period, demo record', async () => {
      const mission = TestBed.inject(MissionService)
      const before = Date.now()
      await TestBed.inject(SampleDataService).loadSampleMission('oso')

      const entries = TestBed.inject(RadioLogService).getCurrentRadioLog().logEntries
      expect(entries.length).toBe(d.rows.length)
      entries.forEach((e) => expect(e.date.getTime(), String(e.id)).toBeLessThan(before))
      expect(TestBed.inject(RangerService).rangers.length).toBe(d.rangers.length)
      expect(TestBed.inject(MissionLocationService).getCurrentLocations().length).toBe(
        d.places.length
      )

      expect(activeDemoScenario()).toBe('oso')
      const record = demoRecord()!
      expect(record.reportIds.length).toBe(entries.length)
      expect(record.rangerUids.length).toBe(d.rangers.length)

      const s = mission.settings
      expect(s.missionMode).toBe('demo')
      expect(s.opPeriod).toBe('Op 2')
      expect(s.tacticalCalls?.length).toBe(40)
      // Centred on Command Post West.
      expect(s.defLat).toBeCloseTo(48.1993, 3)
      expect(s.defLng).toBeCloseTo(-122.1249, 3)
      expect(s.opPeriodStart!.getTime()).toBeGreaterThan(entries[0].date.getTime())
      expect(s.opPeriodStart!.getTime()).toBeLessThan(
        entries[entries.length - 1].date.getTime()
      )

      // Both scribes appear (the hand-over), and station-to-station traffic keeps its own To.
      expect(new Set(entries.map((e) => e.operator)).size).toBe(2)
      expect(entries.some((e) => e.toTactical === 'Command West')).toBe(true)
      expect(entries.some((e) => e.toTactical === undefined)).toBe(true)

      // The Messages page lists the entries that generate an ICS-213: all 51, filled in.
      const messages = entries.filter((e) => e.generates213)
      expect(messages.length).toBe(51)
      messages.forEach((m) => {
        expect(m.subject213, String(m.id)).toBeTruthy()
        expect(m.message213, String(m.id)).toBeTruthy()
        expect(m.recipients213?.length, String(m.id)).toBe(1)
      })
      expect(messages.some((m) => m.replyRequested213)).toBe(true)

      // E-283: three of the other entries are resource requests (ICS-213RR), filled in.
      const requests = entries.filter((e) => e.rr213)
      expect(requests.length).toBe(3)
      requests.forEach((e) => {
        expect(e.generates213, String(e.id)).toBeFalsy()
        expect(e.rr213!.lines.length, String(e.id)).toBeGreaterThan(0)
        expect(e.rr213!.deliverTo, String(e.id)).toBeTruthy()
      })
    })
  })
})
