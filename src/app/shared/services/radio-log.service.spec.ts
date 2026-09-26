import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { RadioLogService } from './radio-log.service';
import { RadioLogType, RadioLogEntryType } from './radio-log-entry.interface';
import { RangerService } from './ranger.service';
// E-122 Phase 2a: field reports now live behind RecordStore, not localStorage directly - see
// that module's own doc comment. resetForTests() is this suite's equivalent of the
// localStorage.clear() it used to rely on for isolation between specs.
import { recordStore } from '../storage/record-store';

/**
 * Characterization tests: pin RadioLogService's current localStorage-backed
 * behavior before the signals rewrite (PRIVATE-Roadmap.md Section 8/R4, Section 12
 * step 3), covering the DoD: localStorage round-trip, bounds calc, and
 * report add/select/delete.
 *
 * RangerService and MissionService are used for real (not mocked): all three
 * domain services are simple localStorage wrappers with no network calls in
 * their construction path, so exercising them together is closer to real
 * behavior than stubbing their public surface.
 */
describe('RadioLogService', () => {
  const STORAGE_KEY = 'radioLog';

  function makeReport(overrides: Partial<RadioLogEntryType> = {}): string {
    return JSON.stringify({
      id: 0,
      callsign: 'TEST1',
      location: { lat: 47.4472, lng: -122.4627, address: '', derivedFromAddress: false },
      date: new Date(),
      status: 'Normal',
      notes: '',
      ...overrides
    });
  }

  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
    TestBed.configureTestingModule({
      providers: [provideHttpClient()]
    });
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  describe('construction / localStorage round-trip', () => {
    it('initializes an empty report set when localStorage is empty', () => {
      const service = TestBed.inject(RadioLogService);
      let latest!: RadioLogType;
      service.getRadioLogObserver().subscribe(r => latest = r);

      expect(latest.numReport).toBe(0);
      expect(latest.logEntries).toEqual([]);
    });

    it('persists a newly added report to localStorage under the "radioLog" key', () => {
      const service = TestBed.inject(RadioLogService);
      service.addRadioLogEntry(makeReport({ callsign: 'ROUND1' }));

      const stored: RadioLogType = JSON.parse(recordStore.getItem(STORAGE_KEY)!);
      expect(stored.logEntries.length).toBe(1);
      expect(stored.logEntries[0].callsign).toBe('ROUND1');
    });

    it('reloads a previously-saved report set on next construction (the actual round-trip)', () => {
      const first = TestBed.inject(RadioLogService);
      first.addRadioLogEntry(makeReport({ callsign: 'PERSISTED' }));

      // Simulate a fresh app load: new injector, same localStorage.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient()] });
      const second = TestBed.inject(RadioLogService);

      let latest!: RadioLogType;
      second.getRadioLogObserver().subscribe(r => latest = r);
      expect(latest.logEntries.some(r => r.callsign === 'PERSISTED')).toBeTrue();
    });

    it('rebuilds from defaults and preserves the original under a "-BAD" key when localStorage has no version marker', () => {
      recordStore.setItem(STORAGE_KEY, '{"garbage": true}');

      const service = TestBed.inject(RadioLogService);
      let latest!: RadioLogType;
      service.getRadioLogObserver().subscribe(r => latest = r);

      expect(latest.numReport).toBe(0);
      expect(recordStore.getItem(STORAGE_KEY + '-BAD')).toContain('garbage');
    });
  });

  describe('addRadioLogEntry', () => {
    it('assigns a sequential id and increments maxId', () => {
      const service = TestBed.inject(RadioLogService);
      const r1 = service.addRadioLogEntry(makeReport());
      const r2 = service.addRadioLogEntry(makeReport());

      expect(r2.id).toBe(r1.id + 1);
    });

    it('publishes the updated set to subscribers', () => {
      const service = TestBed.inject(RadioLogService);
      let latest!: RadioLogType;
      service.getRadioLogObserver().subscribe(r => latest = r);

      service.addRadioLogEntry(makeReport({ callsign: 'PUB1' }));

      expect(latest.logEntries.some(r => r.callsign === 'PUB1')).toBeTrue();
      expect(latest.numReport).toBe(1);
    });
  });

  describe('saveEditedRadioLog (grid edits)', () => {
    it('persists in-place edits to localStorage and republishes them', () => {
      const service = TestBed.inject(RadioLogService);
      const added = service.addRadioLogEntry(makeReport({ callsign: 'EDIT1' }));

      // Exactly what AG Grid does when a cell is edited: the grid binds to the
      // service's own report objects, so it mutates this object directly.
      added.notes = 'corrected by scribe';
      added.location.lat = 47.5;
      service.saveEditedRadioLog();

      const stored: RadioLogType = JSON.parse(recordStore.getItem(STORAGE_KEY)!);
      expect(stored.logEntries[0].notes).toBe('corrected by scribe');

      let latest!: RadioLogType;
      service.getRadioLogObserver().subscribe(r => latest = r);
      expect(latest.logEntries[0].notes).toBe('corrected by scribe');
    });

    it('recalculates bounds so an edited coordinate moves the map extent', () => {
      const service = TestBed.inject(RadioLogService);
      const added = service.addRadioLogEntry(makeReport());

      added.location.lat = 48.5;
      added.location.lng = -120.5;
      service.saveEditedRadioLog();

      const bounds = service.getCurrentRadioLog().bounds;
      expect(bounds.north).toBeGreaterThanOrEqual(48.5);
      expect(bounds.west).toBeLessThanOrEqual(-120.5);
    });
  });

  describe('setSelectedRadioLogEntries / getSelectedRadioLogEntries (select)', () => {
    it('returns an empty selection before anything has been selected', () => {
      const service = TestBed.inject(RadioLogService);
      expect(service.getSelectedRadioLogEntries().logEntries).toEqual([]);
      expect(service.getSelectedRadioLogEntries().numReport).toBe(0);
    });

    it('stores and returns exactly the reports passed to setSelectedRadioLogEntries', () => {
      const service = TestBed.inject(RadioLogService);
      const r1 = service.addRadioLogEntry(makeReport({ callsign: 'SEL1' }));
      service.addRadioLogEntry(makeReport({ callsign: 'SEL2' }));

      service.setSelectedRadioLogEntries([r1]);
      const selected = service.getSelectedRadioLogEntries();

      expect(selected.numReport).toBe(1);
      expect(selected.logEntries[0].callsign).toBe('SEL1');
    });
  });

  describe('deleteAllRadioLogEntries (delete)', () => {
    it('empties the report array and removes the localStorage key', () => {
      const service = TestBed.inject(RadioLogService);
      service.addRadioLogEntry(makeReport());
      service.addRadioLogEntry(makeReport());

      service.deleteAllRadioLogEntries();

      let latest!: RadioLogType;
      service.getRadioLogObserver().subscribe(r => latest = r);
      expect(latest.logEntries).toEqual([]);
      expect(recordStore.getItem(STORAGE_KEY)).toBeNull();
    });

    it('E-114: does NOT reset maxId, so a new report never reuses a cleared report\'s display number', () => {
      const service = TestBed.inject(RadioLogService);
      service.addRadioLogEntry(makeReport());
      const before = service.addRadioLogEntry(makeReport());

      service.deleteAllRadioLogEntries();
      const after = service.addRadioLogEntry(makeReport());

      expect(after.id).toBeGreaterThan(before.id);
    });
  });

  describe('mergeIncomingEntries (E-114 Phase 0)', () => {
    // A minimal RangerType, matching UnknownRanger's shape - only the fields this suite reads.
    const ranger = (over: Partial<{ uid: string, id: string, callsign: string }>) => ({
      uid: 'uid-1', id: 'REW-1', callsign: 'R1', fullName: '', phone: '', image: '',
      team: '', role: '', note: '', ...over,
    });

    const incoming = (over: Partial<RadioLogEntryType> = {}): RadioLogEntryType => ({
      id: 0, callsign: 'REMOTE1',
      location: { lat: 47.4, lng: -122.4, address: '', derivedFromAddress: false },
      date: new Date(), status: 'Normal', notes: 'from a remote device',
      ...over,
    });

    it('assigns each accepted entry a fresh id from this device\'s own maxId, not the sender\'s', () => {
      const service = TestBed.inject(RadioLogService);
      service.addRadioLogEntry(makeReport()); // local report already at id 0

      const { added, skipped } = service.mergeIncomingEntries([incoming({ id: 0 })], 'REW-9');

      expect(added).toBe(1);
      expect(skipped).toBe(0);
      const merged = service.getCurrentRadioLog().logEntries.find(e => e.callsign === 'REMOTE1');
      // The sender's own id was 0 too (a fresh device) - this device did NOT reuse it.
      expect(merged?.id).not.toBe(0);
    });

    it('importing the exact same entries twice is a no-op the second time', () => {
      const service = TestBed.inject(RadioLogService);
      const batch = [incoming({ id: 0 }), incoming({ id: 1, callsign: 'REMOTE2' })];

      const first = service.mergeIncomingEntries(batch, 'REW-9');
      const second = service.mergeIncomingEntries(batch, 'REW-9');

      expect(first).toEqual({ added: 2, skipped: 0, rejected: 0 });
      expect(second).toEqual({ added: 0, skipped: 2, rejected: 0 });
      expect(service.getCurrentRadioLog().logEntries.length).toBe(2);
    });

    it('resolves the reporter credential to a real rangerUid when it matches the roster', () => {
      const service = TestBed.inject(RadioLogService);
      const rangers = TestBed.inject(RangerService);
      rangers.rangers = [ranger({ uid: 'uid-42', id: 'REW-42', callsign: 'K7VMI' })];

      service.mergeIncomingEntries([incoming({ id: 0 })], 'rew-42'); // lower-case, as typed

      const merged = service.getCurrentRadioLog().logEntries[0];
      expect(merged.rangerUid).toBe('uid-42');
    });

    it('keeps callsign with no rangerUid when the credential matches nobody on the roster - not an error', () => {
      const service = TestBed.inject(RadioLogService);
      const rangers = TestBed.inject(RangerService);
      rangers.rangers = [ranger({ uid: 'uid-1', id: 'REW-1' })];

      service.mergeIncomingEntries([incoming({ id: 0, callsign: 'WALKON' })], 'REW-999');

      const merged = service.getCurrentRadioLog().logEntries[0];
      expect(merged.rangerUid).toBeUndefined();
      expect(merged.callsign).toBe('WALKON');
    });

    it('trusts an incoming entry\'s own rangerUid as-is when the sending device already had one (a provisioned device)', () => {
      const service = TestBed.inject(RadioLogService);
      const rangers = TestBed.inject(RangerService);
      rangers.rangers = []; // this device's own roster need not even have the ranger

      service.mergeIncomingEntries([incoming({ id: 0, rangerUid: 'uid-from-sender' })]);

      const merged = service.getCurrentRadioLog().logEntries[0];
      expect(merged.rangerUid).toBe('uid-from-sender');
    });

    it('recalculates numReport and bounds so the existing invariant check never fires on a merge', () => {
      const service = TestBed.inject(RadioLogService);

      service.mergeIncomingEntries([incoming({ id: 0, location: { lat: 48.0, lng: -121.0, address: '', derivedFromAddress: false } })]);

      const log = service.getCurrentRadioLog();
      expect(log.numReport).toBe(log.logEntries.length);
      expect(log.bounds.north).toBeGreaterThanOrEqual(48.0);
    });

    it('a merged entry is stamped with sourceUid, the one thing the Origin marker checks for', () => {
      const service = TestBed.inject(RadioLogService);

      service.mergeIncomingEntries([incoming({ id: 0 })], 'REW-9');

      const merged = service.getCurrentRadioLog().logEntries[0];
      expect(merged.sourceUid).toBeTruthy();
    });

    // E-114 Phase 1, maintainer's own live ask (2026-08-31): "validation of incoming reports,
    // mainly proper timestamps, etc." - a corrupted date or location doesn't just display
    // wrong, it poisons recalcRadioLogBounds()'s min/max math for every report after it.
    describe('rejects a malformed entry rather than merging it', () => {
      it('an unparseable date', () => {
        const service = TestBed.inject(RadioLogService);

        const result = service.mergeIncomingEntries([incoming({ id: 0, date: 'not a date' as any })]);

        expect(result).toEqual({ added: 0, skipped: 0, rejected: 1 });
        expect(service.getCurrentRadioLog().logEntries.length).toBe(0);
      });

      it('a latitude out of range', () => {
        const service = TestBed.inject(RadioLogService);

        const result = service.mergeIncomingEntries([
          incoming({ id: 0, location: { lat: 200, lng: -122.4, address: '', derivedFromAddress: false } })
        ]);

        expect(result).toEqual({ added: 0, skipped: 0, rejected: 1 });
      });

      it('a NaN coordinate', () => {
        const service = TestBed.inject(RadioLogService);

        const result = service.mergeIncomingEntries([
          incoming({ id: 0, location: { lat: NaN, lng: -122.4, address: '', derivedFromAddress: false } })
        ]);

        expect(result).toEqual({ added: 0, skipped: 0, rejected: 1 });
      });

      it('a non-numeric id', () => {
        const service = TestBed.inject(RadioLogService);

        const result = service.mergeIncomingEntries([incoming({ id: 'zero' as any })]);

        expect(result).toEqual({ added: 0, skipped: 0, rejected: 1 });
      });

      it('one bad entry does not cost the good entries in the same packet', () => {
        const service = TestBed.inject(RadioLogService);
        const batch = [
          incoming({ id: 0, date: 'garbage' as any }),
          incoming({ id: 1, callsign: 'GOOD-ONE' }),
        ];

        const result = service.mergeIncomingEntries(batch);

        expect(result).toEqual({ added: 1, skipped: 0, rejected: 1 });
        expect(service.getCurrentRadioLog().logEntries[0].callsign).toBe('GOOD-ONE');
      });
    });
  });

  describe('buildReportPacketText (E-114 Phase 1)', () => {
    it('returns null when there is nothing on this device to send', () => {
      const service = TestBed.inject(RadioLogService);
      expect(service.buildReportPacketText('')).toBeNull();
    });

    it('builds a packet whose text round-trips back to this device\'s own entries', () => {
      const service = TestBed.inject(RadioLogService);
      service.addRadioLogEntry(makeReport());

      const built = service.buildReportPacketText('REW-1');

      expect(built).not.toBeNull();
      const parsed = JSON.parse(built!.text);
      expect(parsed.operator).toBe('REW-1');
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0].callsign).toBe('TEST1');
      expect(built!.count).toBe(1);
      expect(built!.filename).toMatch(/\.txt$/);
    });
  });

  describe('recalcRadioLogBounds (bounds calc)', () => {
    // recalcRadioLogBounds() is now the ONLY path that computes bounds - the
    // second path (Leaflet's LatLngBounds.extend() inside addRadioLogEntry(),
    // which applied no broadening margin) was D-22 and is gone. Calling it
    // directly on a hand-built RadioLogType still pins the Sprint 0
    // west-bound fix (was `>`, now `<`) most precisely.
    function reportsWith(points: { lat: number, lng: number }[]): RadioLogType {
      return {
        version: '1', date: new Date(), event: '',
        bounds: undefined as any, // recalcRadioLogBounds always overwrites this
        numReport: points.length, maxId: points.length, filter: '',
        logEntries: points.map((p, i) => ({
          id: i, callsign: `R${i}`, location: { ...p, address: '', derivedFromAddress: false },
          date: new Date(), status: 'Normal', notes: ''
        }))
      };
    }

    it('shrinks the west edge to the westernmost (most negative) longitude across reports', () => {
      // Regression test for the Sprint 0 fix: this comparison used `>`
      // instead of `<`, so west never actually moved past the first report's
      // longitude no matter what came after it.
      const service = TestBed.inject(RadioLogService);
      const reports = reportsWith([{ lat: 47.45, lng: -122.40 }, { lat: 47.45, lng: -122.50 }]);

      service.recalcRadioLogBounds(reports);

      expect(reports.bounds.west).toBe(-122.50);
    });

    it('expands the east edge to the easternmost (least negative) longitude across reports', () => {
      const service = TestBed.inject(RadioLogService);
      const reports = reportsWith([{ lat: 47.45, lng: -122.50 }, { lat: 47.45, lng: -122.40 }]);

      service.recalcRadioLogBounds(reports);

      expect(reports.bounds.east).toBe(-122.40);
    });

    it('tracks north/south correctly across multiple reports', () => {
      const service = TestBed.inject(RadioLogService);
      const reports = reportsWith([{ lat: 47.40, lng: -122.45 }, { lat: 47.50, lng: -122.45 }]);

      service.recalcRadioLogBounds(reports);

      expect(reports.bounds.north).toBe(47.50);
      expect(reports.bounds.south).toBe(47.40);
    });

    it('broadens a too-narrow bounding box to a minimum margin around a single report', () => {
      const service = TestBed.inject(RadioLogService);
      const reports = reportsWith([{ lat: 47.45, lng: -122.45 }]);

      service.recalcRadioLogBounds(reports);

      // A single point has zero width/height, so the broadening margin must apply.
      expect(reports.bounds.east).toBeGreaterThan(-122.45);
      expect(reports.bounds.west).toBeLessThan(-122.45);
      expect(reports.bounds.north).toBeGreaterThan(47.45);
      expect(reports.bounds.south).toBeLessThan(47.45);
    });

    it('centers the bounds on the mission default lat/lng when there are no reports', () => {
      const service = TestBed.inject(RadioLogService);
      const reports = reportsWith([]);

      service.recalcRadioLogBounds(reports);

      // Settings default is (47.4472, -122.4627); with no reports, bounds
      // fall back to that point, broadened by the margin.
      expect(reports.bounds.south).toBeLessThan(47.4472);
      expect(reports.bounds.north).toBeGreaterThan(47.4472);
      expect(reports.bounds.west).toBeLessThan(-122.4627);
      expect(reports.bounds.east).toBeGreaterThan(-122.4627);
    });
  });
});
