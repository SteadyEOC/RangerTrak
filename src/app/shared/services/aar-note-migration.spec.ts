import { AarNoteType } from './aar-note.interface';
import { AAR_NOTE_SCHEMA_VERSION, migrateAarNotes, normalizeAarNotes } from './aar-note-migration';

describe('aar-note-migration (E-116)', () => {
  it('returns an empty current-version list for nothing stored', () => {
    for (const raw of [null, undefined, 'junk', 42]) {
      expect(migrateAarNotes(raw)).withContext(String(raw))
        .toEqual({ schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: [] });
    }
  });

  it('accepts a bare array and the versioned wrapper', () => {
    const note: AarNoteType = { uid: 'a', createdAt: '2026-09-27T10:00:00.000Z', text: 'Relay out of range', page: 'Map', about: 'incident' };
    expect(migrateAarNotes([note]).notes).toEqual([note]);
    expect(migrateAarNotes({ schemaVersion: 1, notes: [note] }).notes).toEqual([note]);
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

  it('passes a newer schema through untouched', () => {
    const raw = { schemaVersion: AAR_NOTE_SCHEMA_VERSION + 1, notes: [{ future: true }] };
    expect(migrateAarNotes(raw)).toEqual(raw as any);
  });
});
