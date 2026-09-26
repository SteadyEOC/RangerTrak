import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { RangerType } from './ranger.interface';
import { RangerService } from './ranger.service';
import { RANGER_SCHEMA_VERSION } from './ranger-migration';
// E-122 Phase 2a: the roster now lives behind RecordStore, not localStorage directly - see
// that module's own doc comment. resetForTests() is this suite's equivalent of the
// localStorage.clear() it used to rely on for isolation between specs.
import { recordStore } from '../storage/record-store';

/**
 * Characterization tests: pin RangerService's current localStorage-backed
 * behavior before the signals rewrite (PRIVATE-Roadmap.md Section 8/R4, Section 12
 * step 3). These assert what the service actually does today, not what it
 * should do.
 */
describe('RangerService', () => {
  const STORAGE_KEY = 'rangers';

  // ADR D-42/D-43 Phase 2: the roster is stored as a versioned { schemaVersion, rangers }
  // wrapper now, not a bare array. These helpers keep the assertions about CONTENT rather
  // than about the envelope, so a future schema bump does not churn every test here.
  function storedRangers(): RangerType[] {
    const raw = recordStore.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).rangers : [];
  }
  function storedSchemaVersion(): number | undefined {
    const raw = recordStore.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).schemaVersion : undefined;
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

  describe('emptying the roster (0.15.3)', () => {
    it('stays empty across a reload, instead of reseeding the built-in stations', () => {
      const service = TestBed.inject(RangerService);
      // A fresh instance starts blank now (2026-08-26: no more auto-seed) - populate first
      // so there's actually something to delete before proving the delete sticks.
      service.loadHardcodedRangers();
      expect(service.rangers.length).toBeGreaterThan(0);

      service.deleteAllRangers();
      expect(service.rangers.length).toBe(0);

      // The key must still exist, holding an empty list - that is what tells a rebuilt
      // service "emptied on purpose" rather than "never used this app".
      expect(storedRangers()).toEqual([]);

      // Simulate the page reload that onBtnDeleteRangers() performs.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient()] });
      const afterReload = TestBed.inject(RangerService);

      expect(afterReload.rangers.length)
        .withContext('an intentionally emptied roster must not be refilled by the seed')
        .toBe(0);
    });
  });

  describe('parseRosterJson', () => {
    const one = { callsign: 'AA1', fullName: 'Alpha One' };

    it('accepts a bare array', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([one]));
      expect(parsed.length).toBe(1);
      expect(parsed[0].callsign).toBe('AA1');
    });

    it('accepts a { rangers: [...] } wrapper and a full mission export', () => {
      const service = TestBed.inject(RangerService);
      expect(service.parseRosterJson(JSON.stringify({ rangers: [one] })).length).toBe(1);
      expect(service.parseRosterJson(JSON.stringify({
        schemaVersion: 1, settings: {}, radioLog: { logEntries: [] }, rangers: [one]
      })).length).toBe(1);
    });

    it('fills missing optional fields with empty strings rather than undefined', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([one]));
      // Otherwise the grid and the CSV export render "undefined" to an operator.
      expect(parsed[0].phone).toBe('');
      expect(parsed[0].note).toBe('');
      expect(parsed[0].team).toBe('');
    });

    it('rejects entries with no callsign and no id/rew, naming the row', () => {
      const service = TestBed.inject(RangerService);
      expect(() => service.parseRosterJson(JSON.stringify([one, { fullName: 'No Sign' }])))
        .toThrowError(/Entry 2 has no callsign and no id\/rew/);
    });

    it('accepts an entry with no callsign but a resolvable id - D-42, not everyone is ham-licensed', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([{ id: 'VI-0099', fullName: 'No Sign' }]));
      expect(parsed.length).toBe(1);
      expect(parsed[0].callsign).toBe('');
      expect(parsed[0].id).toBe('VI-0099');
    });

    it('accepts an entry with only a legacy rew, seeding id from it', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([{ rew: '38', fullName: 'No Sign' }]));
      expect(parsed.length).toBe(1);
      expect(parsed[0].id).toBe('REW-0038');
    });

    it('maps the field names a real FCC-derived roster actually uses', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([{
        callsign: 'AH6B', licensee: 'Some Person', icon: 'ham.png', status: 'Licensed'
      }]));
      expect(parsed[0].fullName).toBe('Some Person');
      expect(parsed[0].image).toBe('ham.png');
      expect(parsed[0].role).toBe('Licensed');
    });

    it('warns about duplicate callsigns rather than rejecting the whole roster', () => {
      const service = TestBed.inject(RangerService);
      // Refusing a 286-entry roster over one repeated row is the wrong trade.
      const parsed = service.parseRosterJson(JSON.stringify([one, { callsign: 'aa1' }]));
      expect(parsed.length).toBe(2);
      expect(service.rosterWarnings(parsed).join(' ')).toMatch(/duplicate callsign/i);
    });

    it('warns about duplicate ids too - D-42, this is the credential operators actually search on', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([
        { callsign: 'AA1', id: 'VI-0099' }, { callsign: 'AA2', id: 'vi-0099' }]));
      expect(service.rosterWarnings(parsed).join(' ')).toMatch(/duplicate id/i);
    });

    it('warns about blank ids as an expected, not-checked-in-yet state', () => {
      const service = TestBed.inject(RangerService);
      const parsed = service.parseRosterJson(JSON.stringify([one]));
      expect(service.rosterWarnings(parsed).join(' ')).toMatch(/1 of 1 entries have no id/i);
    });

    it('rejects invalid JSON, an empty roster, and a file with no roster in it', () => {
      const service = TestBed.inject(RangerService);
      expect(() => service.parseRosterJson('{oops')).toThrowError(/not valid JSON/);
      expect(() => service.parseRosterJson('[]')).toThrowError(/empty roster/);
      expect(() => service.parseRosterJson('{"settings":{}}')).toThrowError(/does not contain a roster/);
    });

    it('round-trips what the exporter writes', () => {
      const service = TestBed.inject(RangerService);
      // A fresh instance starts blank now (2026-08-26) - parseRosterJson() rejects an empty
      // roster (see "rejects invalid JSON..." above), so this needs real content to round-trip.
      service.loadHardcodedRangers();
      const exported = JSON.stringify({ rangers: service.rangers }, null, 2);
      const parsed = service.parseRosterJson(exported);
      expect(parsed.map(r => r.callsign)).toEqual(service.rangers.map(r => r.callsign));
    });
  });

  // ADR D-42/D-43 Phase 2. The upgrade path is the whole risk of this migration: a fresh
  // install and the dev machine both look perfect no matter what this does. These load data
  // in the PRE-migration shape and assert it survives.
  describe('upgrade path from the pre-D-42 storage shape', () => {
    it('reads a bare array (the old shape) and migrates it in place', () => {
      const legacy = [
        { callsign: 'ACS1', fullName: 'A', phone: '', image: '', rew: 'VI-01', team: '', role: '', note: '' },
        { callsign: 'CERT1', fullName: 'B', phone: '', image: '', rew: '', team: '', role: '', note: '' },
      ];
      recordStore.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const service = TestBed.inject(RangerService);

      expect(service.rangers.length).withContext('roster survived, not reset').toBe(2);
      expect(service.rangers.every(r => !!r.uid)).withContext('every ranger gained a uid').toBeTrue();
      expect(service.rangers.find(r => r.callsign === 'ACS1')!.id).toBe('VI-01');
      expect(service.rangers.find(r => r.callsign === 'CERT1')!.id)
        .withContext('no credential, and none invented').toBe('');
    });

    it('rewrites storage into the versioned wrapper', () => {
      recordStore.setItem(STORAGE_KEY, JSON.stringify([
        { callsign: 'ACS1', fullName: '', phone: '', image: '', rew: '', team: '', role: '', note: '' }
      ]));

      TestBed.inject(RangerService);

      expect(storedSchemaVersion()).toBe(RANGER_SCHEMA_VERSION);
      expect(storedRangers().length).toBe(1);
    });

    it('keeps uids stable across a reload - reports would orphan otherwise', () => {
      recordStore.setItem(STORAGE_KEY, JSON.stringify([
        { callsign: 'ACS1', fullName: '', phone: '', image: '', rew: '', team: '', role: '', note: '' }
      ]));
      const first = TestBed.inject(RangerService).rangers[0].uid;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient()] });
      const afterReload = TestBed.inject(RangerService).rangers[0].uid;

      expect(afterReload).withContext('the join key must not change on reload').toBe(first);
    });
  });

  describe('construction / localStorage round-trip', () => {
    it('starts blank when localStorage is empty (2026-08-26: no more auto-seed)', () => {
      const service = TestBed.inject(RangerService);

      expect(service.rangers.length).toBe(0);
    });

    it('sorts a loaded roster by callsign', () => {
      const service = TestBed.inject(RangerService);
      service.loadHardcodedRangers();

      const callsigns = service.rangers.map(r => r.callsign);
      const sorted = [...callsigns].sort();
      expect(callsigns).toEqual(sorted);
    });

    it('loads an existing roster from localStorage instead of starting blank', () => {
      const seeded: RangerType[] = [
        { callsign: 'ZZZ1', fullName: 'Seeded Ranger', phone: '', image: '', team: '', role: '', note: '' }
      ];
      recordStore.setItem(STORAGE_KEY, JSON.stringify(seeded));

      const service = TestBed.inject(RangerService);

      expect(service.rangers.length).toBe(1);
      expect(service.rangers[0].callsign).toBe('ZZZ1');
    });

    it('falls back to an empty array (not a throw) when localStorage contains invalid JSON', () => {
      recordStore.setItem(STORAGE_KEY, '{not valid json');

      const service = TestBed.inject(RangerService);

      expect(service.rangers.length).toBe(0);
    });
  });

  describe('AddRanger', () => {
    it('appends a ranger and persists it to localStorage', () => {
      const service = TestBed.inject(RangerService);
      const before = service.rangers.length;

      const added = service.AddRanger(JSON.stringify({
        callsign: 'TEST1', fullName: 'Test Ranger', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));

      expect(added.callsign).toBe('TEST1');
      expect(service.rangers.length).toBe(before + 1);

      const persisted: RangerType[] = storedRangers();
      expect(persisted.some(r => r.callsign === 'TEST1')).toBeTrue();
    });

    it('publishes the updated roster to subscribers', () => {
      const service = TestBed.inject(RangerService);
      let latest: RangerType[] = [];
      service.getRangersObserver().subscribe(r => latest = r);

      service.AddRanger(JSON.stringify({
        callsign: 'TEST2', fullName: 'Test Ranger 2', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));

      expect(latest.some(r => r.callsign === 'TEST2')).toBeTrue();
    });
  });

  describe('updateRanger / deleteRanger', () => {
    it('updates an existing ranger by callsign', () => {
      const service = TestBed.inject(RangerService);
      service.AddRanger(JSON.stringify({
        callsign: 'UPD1', fullName: 'Original Name', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));

      // ADR D-43: updates match on uid, not callsign - AddRanger() returns the ranger with
      // its minted uid, which is what makes this addressable at all.
      const existing = service.getRangerByCallsign('UPD1');
      service.updateRanger({ ...existing, fullName: 'Changed Name' });

      expect(service.getRangerByCallsign('UPD1').fullName).toBe('Changed Name');
    });

    it('refuses to update a ranger with no uid rather than guessing which row was meant', () => {
      const service = TestBed.inject(RangerService);
      service.AddRanger(JSON.stringify({
        callsign: 'NOUID', fullName: 'Original', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));

      service.updateRanger({
        callsign: 'NOUID', fullName: 'Should Not Apply', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      } as RangerType);

      expect(service.getRangerByCallsign('NOUID').fullName).toBe('Original');
    });

    it('lets a callsign be edited - the old lookup could never save this', () => {
      // Regression guard for what keying updates on callsign actually broke: the lookup
      // searched for the NEW callsign, found nothing, and silently dropped the edit.
      const service = TestBed.inject(RangerService);
      const added = service.AddRanger(JSON.stringify({
        callsign: 'OLDSIGN', fullName: 'Renamed Person', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));

      service.updateRanger({ ...added, callsign: 'NEWSIGN' });

      expect(service.rangers.some(r => r.callsign === 'NEWSIGN')).toBeTrue();
      expect(service.rangers.some(r => r.callsign === 'OLDSIGN')).toBeFalse();
    });

    it('deletes a ranger by uid and persists the removal', () => {
      const service = TestBed.inject(RangerService);
      const added = service.AddRanger(JSON.stringify({
        callsign: 'DEL1', fullName: 'To Delete', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));
      const before = service.rangers.length;

      service.deleteRangerByUid(added.uid!);

      expect(service.rangers.length).toBe(before - 1);
      expect(service.rangers.some(r => r.callsign === 'DEL1')).toBeFalse();

      const persisted: RangerType[] = storedRangers();
      expect(persisted.some(r => r.callsign === 'DEL1')).toBeFalse();
    });

    it('returns the UnknownRanger sentinel for a callsign that does not exist', () => {
      const service = TestBed.inject(RangerService);
      expect(service.getRangerByCallsign('DOES_NOT_EXIST').callsign).toBe('Unknown');
    });
  });

  describe('deleteAllRangers', () => {
    // Changed deliberately in 0.15.3. This used to assert the key was REMOVED, which is
    // what made "Delete Rangers" impossible to complete: the next page load saw no stored
    // roster, concluded it was a first run, and seeded the 18 built-in stations again.
    // Storing an empty list is what makes the deletion stick - see the reload test above.
    it('clears the in-memory roster and stores an empty list, keeping the key', () => {
      const service = TestBed.inject(RangerService);
      // A fresh instance starts blank now (2026-08-26: no more auto-seed) - populate first
      // so there's actually something for this test to delete.
      service.loadHardcodedRangers();
      expect(service.rangers.length).toBeGreaterThan(0);

      service.deleteAllRangers();

      expect(service.rangers.length).toBe(0);
      expect(storedRangers()).toEqual([]);
    });
  });

  // D-32 readiness signal, simplified 2026-08-26: a fresh install now starts blank (nothing
  // auto-seeds it - "Rangers should start blank, that should indicate a new mission"), so
  // there's no untouched-default state left to distinguish from real. Plain length check.
  describe('isRealRosterLoaded (D-32)', () => {
    it('is false straight off a fresh instance (blank roster, new mission)', () => {
      const service = TestBed.inject(RangerService);
      expect(service.rangers.length).toBe(0);
      expect(RangerService.isRealRosterLoaded(service.rangers)).toBe(false);
    });

    it('is false for an explicitly empty array', () => {
      expect(RangerService.isRealRosterLoaded([])).toBe(false);
    });

    it('is true once any ranger is present, however they got there', () => {
      const withOne: RangerType[] = [
        { callsign: 'REAL1', fullName: 'A Real Person', phone: '', image: '', team: '', role: '', note: '' },
      ];
      expect(RangerService.isRealRosterLoaded(withOne)).toBe(true);
    });

    it('is true for the opt-in hardcoded station set too - presence is what matters now', () => {
      const service = TestBed.inject(RangerService);
      service.loadHardcodedRangers();
      expect(RangerService.isRealRosterLoaded(service.rangers)).toBe(true);
    });
  });
});
