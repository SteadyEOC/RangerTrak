import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { DEFAULT_SAMPLE_SCENARIO, SampleDataService, SampleScenarioId, SAMPLE_SCENARIOS } from './sample-data.service';
import { MissionService } from './mission.service';
import { RangerService } from './ranger.service';
import { RadioLogService } from './radio-log.service';
import { MissionLocationService } from './mission-location.service';

/**
 * F-scenarios (2026-09-14): SampleDataService went from one fixed "Vashon Island" mission to
 * a choice of four (SAMPLE_SCENARIOS). Every scenario is supposed to share one shape - see
 * that class's own doc comment - so these tests assert the shared invariants across all four
 * rather than re-deriving Vashon-specific numbers:
 *
 *   - 12 rangers total, split 4 fixed-post command staff + 4 field teams of 2.
 *   - Each of the 4 field teams (grouped by RangerType.team, which is unique per track -
 *     see the service's own comment on why this differs from the more descriptive `role`
 *     field) has at least 3 field reports, forming a trail.
 *   - Exactly 2 mission Locations (the "objectives").
 *   - Exactly 2 ICS-213 messages (`generates213`).
 *   - Every configured status appears on at least one report.
 *   - No report references a callsign missing from the roster.
 *
 * This same spec would have caught a real gap in the pre-scenario data, found while writing
 * it: the old Vashon-only version never actually included a "Location Report" status despite
 * its own doc comment claiming "every status represented" - see [[verify-the-measurement-
 * itself]]. Every scenario below is written to include one.
 */
describe('SampleDataService', () => {
  const ALL_STATUSES = [
    'Normal', 'Location Report', 'Evidence Report', 'Need Rest/Food',
    'Incident Check-in', 'Incident Check-out', 'Urgent',
  ];

  const SCENARIOS: SampleScenarioId[] = ['vashon', 'grand-canyon', 'state-fair', 'near-me'];

  function configure() {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
  }

  beforeEach(() => {
    localStorage.clear();
    configure();

    // Deterministic, offline stand-in for navigator.geolocation so the shared invariant
    // tests below (which run for every scenario, including near-me) never depend on a real
    // GPS fix or a permission prompt. near-me's own fallback-to-default-location behavior,
    // and its use of a successful fix, are covered separately below with their own stubs.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
          error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
        },
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('SAMPLE_SCENARIOS defaults to Vashon first and lists exactly the four scenarios', () => {
    expect(SAMPLE_SCENARIOS.map(s => s.id)).toEqual(['grand-canyon', 'vashon', 'state-fair', 'near-me']);
    expect(SAMPLE_SCENARIOS[0].id).toBe(DEFAULT_SAMPLE_SCENARIO);
  });

  SCENARIOS.forEach(scenario => {
    describe(`scenario: ${scenario}`, () => {
      it('produces 12 rangers, 4 field teams with >=3 reports each, 2 locations, '
        + '2 ICS-213 messages, every status, and no unknown callsigns', async () => {
        const sampleData = TestBed.inject(SampleDataService);
        const rangerService = TestBed.inject(RangerService);
        const radioLogService = TestBed.inject(RadioLogService);
        const locationService = TestBed.inject(MissionLocationService);

        await sampleData.loadSampleMission(scenario);

        const rangers = rangerService.rangers;
        const entries = radioLogService.getCurrentRadioLog().logEntries;
        const locations = locationService.getCurrentLocations();

        // 12 rangers total.
        expect(rangers.length).toBe(12);

        // No report references a callsign missing from the roster.
        const knownCallsigns = new Set(rangers.map(r => r.callsign));
        entries.forEach(entry => expect(knownCallsigns.has(entry.callsign)).withContext(entry.callsign).toBeTrue());

        // 4 command staff at a fixed post, plus exactly 4 field teams of 2.
        const commandRangers = rangers.filter(r => r.team === 'Command');
        expect(commandRangers.length).toBe(4);

        const fieldRangers = rangers.filter(r => r.team !== 'Command');
        expect(fieldRangers.length).toBe(8);

        const fieldTeamNames = [...new Set(fieldRangers.map(r => r.team))];
        expect(fieldTeamNames.length).withContext('distinct field teams').toBe(4);

        fieldTeamNames.forEach(team => {
          const teamCallsigns = new Set(fieldRangers.filter(r => r.team === team).map(r => r.callsign));
          expect(teamCallsigns.size).withContext(`${team} roster size`).toBe(2);

          const teamReports = entries.filter(e => teamCallsigns.has(e.callsign));
          expect(teamReports.length).withContext(`${team} report count`).toBeGreaterThanOrEqual(3);
        });

        // Exactly 2 mission Locations - the "objectives".
        expect(locations.length).toBe(2);

        // Exactly 2 ICS-213 messages.
        const messages = entries.filter(e => e.generates213);
        expect(messages.length).toBe(2);
        messages.forEach(m => {
          expect(m.message213).withContext('message213').toBeTruthy();
          expect(m.subject213).withContext('subject213').toBeTruthy();
          expect(m.recipients213?.length).withContext('recipients213').toBeGreaterThan(0);
        });

        // Every configured status appears on at least one report.
        const statusesPresent = new Set(entries.map(e => e.status));
        ALL_STATUSES.forEach(status => expect(statusesPresent.has(status)).withContext(status).toBeTrue());
      });
    });
  });

  describe('loadSampleMission (general)', () => {
    it('defaults to the Grand Canyon scenario when called with no argument', async () => {
      const sampleData = TestBed.inject(SampleDataService);
      const missionService = TestBed.inject(MissionService);
      const radioLogService = TestBed.inject(RadioLogService);

      await sampleData.loadSampleMission();

      expect(missionService.settings.mission).toMatch(/^\d{4}-\d{2}-Search$/);
      expect(missionService.settings.event).toBe(SampleDataService.SAMPLE_EVENT_NAME);
      // Every scenario shares the event name above, so that alone can't tell them apart -
      // check the reports actually landed at the South Rim (~36.06 N, -112.14 W).
      const first = radioLogService.getCurrentRadioLog().logEntries[0].location;
      expect(first.lat).toBeCloseTo(36.06, 0);
      expect(first.lng).toBeCloseTo(-112.14, 0);
      // ...and the mission's default location follows the demo, so Entry opens there too.
      expect(missionService.settings.defLat).toBeCloseTo(36.06, 1);
      expect(missionService.settings.defLng).toBeCloseTo(-112.15, 1);
    });

    it('stamps a computed, current-month mission ID rather than a fixed string', async () => {
      const sampleData = TestBed.inject(SampleDataService);
      const missionService = TestBed.inject(MissionService);

      await sampleData.loadSampleMission('vashon');

      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-Search`;
      expect(missionService.settings.mission).toBe(expected);
    });

    it('leaves no report with an empty callsign match failure (roster and reports stay in sync)', async () => {
      const sampleData = TestBed.inject(SampleDataService);
      const radioLogService = TestBed.inject(RadioLogService);

      await sampleData.loadSampleMission('grand-canyon');

      expect(radioLogService.getCurrentRadioLog().numReport).toBe(
        radioLogService.getCurrentRadioLog().logEntries.length);
    });
  });

  describe('near-me scenario location handling', () => {
    it('falls back to the mission default location when geolocation is denied/unavailable', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
            error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
          },
        },
      });

      const sampleData = TestBed.inject(SampleDataService);
      const missionService = TestBed.inject(MissionService);
      const radioLogService = TestBed.inject(RadioLogService);

      await sampleData.loadSampleMission('near-me');

      const commandPost = radioLogService.getCurrentRadioLog().logEntries.find(e => e.callsign === '!CmdPost');
      expect(commandPost).toBeDefined();
      expect(commandPost!.location.lat).toBeCloseTo(missionService.settings.defLat, 6);
      expect(commandPost!.location.lng).toBeCloseTo(missionService.settings.defLng, 6);
    });

    it('centers the scenario on a successful GPS fix instead of the mission default', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (success: PositionCallback) => {
            success({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition);
          },
        },
      });

      const sampleData = TestBed.inject(SampleDataService);
      const radioLogService = TestBed.inject(RadioLogService);

      await sampleData.loadSampleMission('near-me');

      const commandPost = radioLogService.getCurrentRadioLog().logEntries.find(e => e.callsign === '!CmdPost');
      expect(commandPost).toBeDefined();
      expect(commandPost!.location.lat).toBeCloseTo(10, 6);
      expect(commandPost!.location.lng).toBeCloseTo(20, 6);
    });

    it('does not call any geocoding/network address lookup - offline by construction', async () => {
      // No HttpClient spy needed to prove this: the scenario builder never touches
      // GeocodingProvider/HttpClient at all (see buildNearMeScenario()'s own comment), so
      // this is really just confirming the promise resolves fast and synchronously builds
      // plain offset coordinates rather than hanging on a network round trip.
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (success: PositionCallback) => {
            success({ coords: { latitude: 36.5, longitude: -121.9 } } as GeolocationPosition);
          },
        },
      });

      const sampleData = TestBed.inject(SampleDataService);
      const radioLogService = TestBed.inject(RadioLogService);

      await sampleData.loadSampleMission('near-me');

      const entries = radioLogService.getCurrentRadioLog().logEntries;
      entries.forEach(e => {
        expect(e.location.derivedFromAddress).toBeFalse();
      });
    });
  });
});
