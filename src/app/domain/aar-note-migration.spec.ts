import { AarNoteType } from '../shared/services/aar-note.interface';
import { AAR_NOTE_SCHEMA_VERSION, migrateAarNotes, noteTime, normalizeAarNotes } from './aar-note-migration';

describe('aar-note-migration (E-116)', () => {
  it('returns an empty current-version list for nothing stored', () => {
    for (const raw of [null, undefined, 'junk', 42]) {
      expect(migrateAarNotes(raw)).withContext(String(raw))
        .toEqual({ schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: [] });
    }
  });

  it('accepts a bare array and the versioned wrapper', () => {
    const note: AarNoteType = { uid: 'a', createdAt: '2026-09-27T10:00:00.000Z', text: 'Relay out of range', page: 'Map', about: 'incident', kind: 'aar' };
    expect(migrateAarNotes([note]).notes).toEqual([note]);
    expect(migrateAarNotes({ schemaVersion: 2, notes: [note] }).notes).toEqual([note]);
  });

  it('repairs a damaged note and drops what is not a note', () => {
    const notes = normalizeAarNotes([
      { text: 'no uid, no about', about: 'nonsense', area: '  ' },
      { uid: 'x', text: '   ' },
      'not an object',
      null,
    ]);
    expect(notes.length).toBe(1);
    expect(notes[0].uid).toBeTruthy();
    expect(notes[0].about).toBe('incident');
    expect(notes[0].page).toBe('');
    expect('area' in notes[0]).withContext('a blank area is left off').toBeFalse();
    expect(notes[0].createdAt).toBeTruthy();
  });

  it('mints a new uid for a duplicate', () => {
    const notes = normalizeAarNotes([{ uid: 'dup', text: 'one' }, { uid: 'dup', text: 'two' }]);
    expect(notes[0].uid).toBe('dup');
    expect(notes[1].uid).not.toBe('dup');
  });

  it('is idempotent', () => {
    const once = normalizeAarNotes([{ text: 'a' }, { uid: 'b', text: 'b', about: 'app', owner: 'Logistics' }]);
    expect(normalizeAarNotes(once)).toEqual(once);
  });

  // HSEEP capability element (POETE), schema 3
  it('keeps a valid capability element and drops a blank or unknown one', () => {
    const notes = normalizeAarNotes([
      { uid: 'a', text: 'Repeater batteries flat', capability: 'equipment' },
      { uid: 'b', text: 'No net control relief', capability: 'staffing' },
      { uid: 'c', text: 'Unclear check-in times', capability: '' },
      { uid: 'd', text: 'Log the shift change', kind: 'activity', capability: 'training' },
    ]);
    expect(notes[0].capability).toBe('equipment');
    expect('capability' in notes[1]).withContext('not one of the five POETE elements').toBeFalse();
    expect('capability' in notes[2]).withContext('blank').toBeFalse();
    expect('capability' in notes[3]).withContext('an ICS-214 line never carries review fields').toBeFalse();
  });

  it('reads schema 2 notes (no capability) unchanged, as schema 3', () => {
    const note: AarNoteType = { uid: 'a', createdAt: '2026-11-01T10:00:00.000Z', text: 'Relay out of range', page: 'Map', about: 'incident', kind: 'aar', area: 'Comms' };
    expect(migrateAarNotes({ schemaVersion: 2, notes: [note] })).toEqual({ schemaVersion: 3, notes: [note] });
    expect(AAR_NOTE_SCHEMA_VERSION).toBe(3);
  });

  it('passes a newer schema through untouched', () => {
    const raw = { schemaVersion: AAR_NOTE_SCHEMA_VERSION + 1, notes: [{ future: true }] };
    expect(migrateAarNotes(raw)).toEqual(raw as any);
  });

  // E-04 / D-63
  it('reads schema 1 notes (no kind) as AAR notes', () => {
    const v1 = { schemaVersion: 1, notes: [{ uid: 'a', createdAt: '2026-09-27T10:00:00.000Z', text: 'old', page: 'Map', about: 'app', area: 'Comms' }] };
    const out = migrateAarNotes(v1);
    expect(out.schemaVersion).toBe(AAR_NOTE_SCHEMA_VERSION);
    expect(out.notes[0].kind).toBe('aar');
    expect(out.notes[0].about).toBe('app');
    expect(out.notes[0].area).toBe('Comms');
  });

  it('treats a missing or unknown kind as aar', () => {
    const notes = normalizeAarNotes([{ text: 'a' }, { text: 'b', kind: 'weird' }, { text: 'c', kind: 42 }]);
    expect(notes.map(n => n.kind)).toEqual(['aar', 'aar', 'aar']);
  });

  it('keeps an activity line as incident-only with no review fields', () => {
    const [n] = normalizeAarNotes([{ text: 'Net open', kind: 'activity', about: 'app', area: 'x', recommendation: 'y', owner: 'z', at: '2026-10-20T14:05:00.000Z' }]);
    expect(n.kind).toBe('activity');
    expect(n.about).toBe('incident');
    expect('area' in n || 'recommendation' in n || 'owner' in n).toBeFalse();
    expect(n.at).toBe('2026-10-20T14:05:00.000Z');
  });

  it('drops an unparseable at, and noteTime falls back to createdAt', () => {
    const [n] = normalizeAarNotes([{ text: 'a', kind: 'activity', createdAt: '2026-10-20T10:00:00.000Z', at: 'not a date' }]);
    expect('at' in n).toBeFalse();
    expect(noteTime(n)).toBe('2026-10-20T10:00:00.000Z');
    expect(noteTime({ createdAt: 'c', at: 'a' })).toBe('a');
  });
});
