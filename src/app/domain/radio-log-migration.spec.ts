import { RadioLogType } from '../shared/services/radio-log-entry.interface';
import { RADIO_LOG_SCHEMA_VERSION, migrateRadioLog } from './radio-log-migration';

/**
 * The radio-log versioning seam (2026-08-26). There is deliberately no data transform
 * behind it yet - no legacy reports exist to transform - so these pin the seam's *contract*
 * rather than any particular migration: what counts as a usable store, what happens to data
 * from a newer build, and that a re-run is inert.
 */
describe('radio-log-migration', () => {

  it('gives every entry without a uid one (D-59) and keeps an existing uid', () => {
    const entry = (id: number, uid?: string) => ({
      id, uid, callsign: 'A', status: 'Normal', notes: '',
      location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
      date: new Date(),
    });
    const result = migrateRadioLog(store({
      schemaVersion: 1, logEntries: [entry(0), entry(1, 'keep-me'), entry(2)] as never
    }))!;

    expect(result.logEntries[1].uid).toBe('keep-me');
    expect(result.logEntries[0].uid).toBeTruthy();
    expect(result.logEntries[2].uid).toBeTruthy();
    expect(result.logEntries[0].uid).not.toBe(result.logEntries[2].uid);
    // A second run keeps what the first minted.
    expect(migrateRadioLog(result)!.logEntries.map(e => e.uid)).toEqual(result.logEntries.map(e => e.uid));
  });

  function store(extra: Partial<RadioLogType> = {}): RadioLogType {
    return {
      version: '0.55.0', date: new Date(), event: '',
      bounds: { north: 1, south: -1, east: 1, west: -1 },
      numReport: 0, maxId: 0, filter: '', logEntries: [],
      ...extra
    } as RadioLogType;
  }

  it('stamps the current version onto an unversioned store', () => {
    const result = migrateRadioLog(store());

    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(RADIO_LOG_SCHEMA_VERSION);
  });

  it('preserves everything else while stamping', () => {
    const original = store({ event: 'Exercise', numReport: 3, maxId: 7 });

    const result = migrateRadioLog(original)!;

    expect(result.event).toBe('Exercise');
    expect(result.numReport).toBe(3);
    expect(result.maxId).toBe(7);
    expect(result.version).toBe('0.55.0');
  });

  it('is idempotent - a second run changes nothing', () => {
    const once = migrateRadioLog(store())!;
    const twice = migrateRadioLog(once)!;

    expect(twice).toEqual(once);
  });

  it('leaves data from a NEWER build alone rather than downgrading it', () => {
    const future = store({ schemaVersion: RADIO_LOG_SCHEMA_VERSION + 5 } as Partial<RadioLogType>);

    const result = migrateRadioLog(future)!;

    expect(result.schemaVersion).toBe(RADIO_LOG_SCHEMA_VERSION + 5);
  });

  it('returns null for anything that is not a usable store', () => {
    // null means "call your own initializer" - building an empty store needs MissionService,
    // and that logic already lives in RadioLogService.initEmptyRadioLog().
    for (const junk of [null, undefined, 'nonsense', 42, [], {}]) {
      expect(migrateRadioLog(junk)).toBeNull();
    }
  });

  it('rejects an object missing the report array specifically', () => {
    const { logEntries, ...withoutArray } = store();

    expect(migrateRadioLog(withoutArray)).toBeNull();
  });

  it('does not mutate the store passed in', () => {
    const original = store();
    const snapshot = JSON.stringify(original);

    migrateRadioLog(original);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

/**
 * The 0.90.5 JSON-date bug, radio-log half. See json-dates.ts for the class of bug; the
 * concrete symptom here was that buildIcs309Log() threw `getTime is not a function` for any
 * operator with two or more saved reports, because their `date` was an ISO string.
 *
 * These deliberately round-trip through JSON.parse(JSON.stringify(...)) - the same thing
 * localStorage and a .rtmission backup do - rather than hand-writing string literals, so
 * they exercise the real cause rather than a guess at it.
 */
describe('migrateRadioLog clue heading (E-268)', () => {
  it('nulls a bad evidenceDirection on load or restore and keeps a good one', () => {
    const base = { callsign: 'A', status: 'Normal', notes: '', location: { lat: 0, lng: 0, address: '', derivedFromAddress: false }, date: '2026-08-31T12:00:00.000Z' }
    const out = migrateRadioLog({
      version: '1', logEntries: [
        { ...base, id: 0, evidenceDirection: 45 },
        { ...base, id: 1, evidenceDirection: 999 },
        { ...base, id: 2, evidenceDirection: 'x' },
        { ...base, id: 3 },
      ],
    })
    expect(out!.logEntries.map(e => e.evidenceDirection)).toEqual([45, null, null, undefined])
  })
})

describe('migrateRadioLog date rehydration', () => {

  function roundTripped(extra: Partial<RadioLogType> = {}): RadioLogType {
    const live = {
      version: '0.90.5', date: new Date('2026-08-31T10:00:00.000Z'), event: '',
      bounds: { north: 1, south: -1, east: 1, west: -1 },
      numReport: 2, maxId: 2, filter: '',
      schemaVersion: RADIO_LOG_SCHEMA_VERSION,
      logEntries: [
        {
          id: 0, callsign: 'ACS1', status: 'Normal', notes: '',
          location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
          date: new Date('2026-08-31T12:00:00.000Z'),
        },
        {
          id: 1, callsign: 'ACS2', status: 'Normal', notes: '',
          location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
          date: new Date('2026-08-31T09:00:00.000Z'),
          revisedAt: new Date('2026-08-31T13:00:00.000Z'),
          printedAt: new Date('2026-08-31T14:00:00.000Z'),
        },
      ],
      ...extra
    } as RadioLogType;
    return JSON.parse(JSON.stringify(live)) as RadioLogType;
  }

  it('restores the store\'s own date', () => {
    const stored = roundTripped();
    expect(typeof (stored.date as unknown)).toBe('string'); // precondition

    const result = migrateRadioLog(stored);

    expect(result!.date instanceof Date).toBe(true);
  });

  it('restores every entry timestamp, including the optional ones', () => {
    const result = migrateRadioLog(roundTripped());

    expect(result!.logEntries[0].date instanceof Date).toBe(true);
    expect(result!.logEntries[1].date instanceof Date).toBe(true);
    expect(result!.logEntries[1].revisedAt instanceof Date).toBe(true);
    expect(result!.logEntries[1].printedAt instanceof Date).toBe(true);
  });

  it('preserves each instant exactly', () => {
    const result = migrateRadioLog(roundTripped());

    expect(result!.logEntries[0].date.toISOString()).toBe('2026-08-31T12:00:00.000Z');
    expect(result!.logEntries[1].date.toISOString()).toBe('2026-08-31T09:00:00.000Z');
  });

  it('leaves an absent optional timestamp absent, rather than defaulting it to the epoch', () => {
    const result = migrateRadioLog(roundTripped());

    expect(result!.logEntries[0].revisedAt).toBeUndefined();
    expect(result!.logEntries[0].printedAt).toBeUndefined();
  });

  it('restores dates even for a store from a NEWER schema, which is returned unmigrated', () => {
    // The newer-than-we-understand branch returns early. Deserialization still has to
    // happen there or this build throws while rendering data it chose not to migrate.
    const result = migrateRadioLog(roundTripped({
      schemaVersion: RADIO_LOG_SCHEMA_VERSION + 1
    } as Partial<RadioLogType>));

    expect(result!.schemaVersion).toBe(RADIO_LOG_SCHEMA_VERSION + 1);
    expect(result!.logEntries[0].date instanceof Date).toBe(true);
  });

  it('makes a round-tripped store safe to sort the way buildIcs309Log does', () => {
    const result = migrateRadioLog(roundTripped());

    // The exact expression that threw on 0.90.5.
    expect(() => [...result!.logEntries]
      .sort((a, b) => a.date.getTime() - b.date.getTime())).not.toThrow();
  });
});

/** E-220 / D-68: schema 2 -> 3 numbers the unnumbered entries. */
describe('migrateRadioLog 2 -> 3 (message numbers)', () => {
  const entry = (id: number, minutes: number, extra: Record<string, unknown> = {}) => ({
    id, uid: `u${id}`, callsign: 'A', status: 'Normal', notes: '',
    location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
    date: new Date(Date.UTC(2026, 9, 23, 10, minutes)), ...extra,
  });
  const v2 = (logEntries: unknown[]) => ({
    version: '0.99.79', schemaVersion: 2, date: new Date(), event: '',
    bounds: { north: 1, south: -1, east: 1, west: -1 }, numReport: logEntries.length, maxId: logEntries.length,
    filter: '', logEntries,
  });

  it('numbers entries in time order as station A with the current mission and op period', () => {
    // Stored out of time order on purpose.
    const result = migrateRadioLog(v2([entry(0, 30), entry(1, 10), entry(2, 20)]), { mission: '26-0142', opPeriod: 'OP 2' })!;

    expect(result.schemaVersion).toBe(3);
    expect(result.logEntries.map(e => e.msgNo!.seq)).toEqual([3, 1, 2]);
    expect(result.logEntries[0].msgNo).toEqual({ mission: '26-0142', opPeriod: 'OP 2', station: 'A', seq: 3 });
    expect(result.msgNoHighWater!['OP 2\u0000A']).toBe(3);
  });

  it('keeps a number an entry already has and numbers the rest after it', () => {
    const had = { mission: 'm', opPeriod: 'OP 2', station: 'A', seq: 5 };
    const result = migrateRadioLog(v2([entry(0, 10, { msgNo: had }), entry(1, 20)]), { mission: 'm', opPeriod: 'OP 2' })!;

    expect(result.logEntries[0].msgNo).toEqual(had);
    expect(result.logEntries[1].msgNo!.seq).toBe(6);
  });

  it('is inert on a second run', () => {
    const once = migrateRadioLog(v2([entry(0, 10), entry(1, 20)]))!;
    const twice = migrateRadioLog(JSON.parse(JSON.stringify(once)))!;

    expect(twice.logEntries.map(e => e.msgNo)).toEqual(once.logEntries.map(e => e.msgNo));
    expect(twice.msgNoHighWater).toEqual(once.msgNoHighWater);
  });

  it('numbers nothing on a field phone, which stamps nothing', () => {
    const result = migrateRadioLog(v2([entry(0, 10)]), { number: false })!;
    expect(result.logEntries[0].msgNo).toBeUndefined();
  });

  it("restores a status mark's time after a round trip", () => {
    const marked = entry(0, 10, { msgNo: { mission: '', opPeriod: '', station: 'A', seq: 1 }, handled: { mark: 'handled', at: new Date(Date.UTC(2026, 9, 23, 11)) } });
    const result = migrateRadioLog(JSON.parse(JSON.stringify({ ...v2([marked]), schemaVersion: 3 })))!;

    expect(result.logEntries[0].handled!.at instanceof Date).toBeTrue();
  });
});
