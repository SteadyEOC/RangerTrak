import { TestBed } from '@angular/core/testing';

import { AarNoteService } from './aar-note.service';
import { recordStore } from '../storage/record-store';
import { AAR_NOTE_SCHEMA_VERSION, normalizeAarNotes } from '../../domain/aar-note-migration';
import { AAR_CAPABILITIES } from './aar-note.interface';

describe('AarNoteService (E-116)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  it('starts empty on a device that has never saved a note', () => {
    expect(TestBed.inject(AarNoteService).notes()).toEqual([]);
  });

  it('captures a note with its page and time, and ignores blank text', () => {
    const service = TestBed.inject(AarNoteService);
    expect(service.addNote('   ', 'incident', 'Entry')).toBeNull();

    const note = service.addNote('  Relay point out of range  ', 'incident', 'Map')!;
    expect(note.text).toBe('Relay point out of range');
    expect(note.page).toBe('Map');
    expect(note.about).toBe('incident');
    expect(Date.parse(note.createdAt)).not.toBeNaN();
    expect(service.notes().length).toBe(1);
  });

  // The migration keeps its own copy of the POETE list (ADR D-57); this keeps the two in step.
  it('keeps every capability element the page offers', () => {
    const notes = normalizeAarNotes(AAR_CAPABILITIES.map((c, i) => ({ uid: 'c' + i, text: c, capability: c })));
    expect(notes.map(n => n.capability)).toEqual(AAR_CAPABILITIES);
  });

  it('persists through RecordStore under a versioned wrapper', () => {
    const service = TestBed.inject(AarNoteService);
    service.addNote('MGRS field slow to type', 'app', 'Entry');

    const stored = JSON.parse(recordStore.getItem('aarNotes')!);
    expect(stored.schemaVersion).toBe(AAR_NOTE_SCHEMA_VERSION);
    expect(stored.notes[0].kind).toBe('aar');
    expect(stored.notes[0].text).toBe('MGRS field slow to type');
  });

  it('updates, deletes one, and deletes all', () => {
    const service = TestBed.inject(AarNoteService);
    const a = service.addNote('first', 'incident', 'Entry')!;
    const b = service.addNote('second', 'incident', 'Entry')!;

    service.updateNote({ ...a, area: 'Communications', recommendation: 'Add a relay', owner: 'Comms lead' });
    expect(service.notes()[0].area).toBe('Communications');
    expect(service.notes()[0].uid).toBe(a.uid);

    service.updateNote({ ...a, text: '  ' });
    expect(service.notes()[0].text).withContext('blank text keeps the previous version').toBe('first');

    service.deleteNote(b.uid);
    expect(service.notes().map(n => n.uid)).toEqual([a.uid]);

    service.deleteAllNotes();
    expect(service.notes()).toEqual([]);
  });

  it('replaceAllNotes normalizes what it is given', () => {
    const service = TestBed.inject(AarNoteService);
    service.replaceAllNotes([{ text: 'from a backup' }, { junk: true }]);
    expect(service.notes().length).toBe(1);
    expect(service.notes()[0].uid).toBeTruthy();
  });

  // E-04 / D-63
  it('captures an ICS-214 line: always about the incident, with an edited time only when given', () => {
    const service = TestBed.inject(AarNoteService);
    const plain = service.addNote('Net opened', 'app', 'Entry', 'activity')!;
    expect(plain.kind).toBe('activity');
    expect(plain.about).toBe('incident');
    expect('at' in plain).toBeFalse();

    const edited = service.addNote('Shift change', 'incident', 'Map', 'activity', '2026-10-20T07:30:00.000Z')!;
    expect(edited.at).toBe('2026-10-20T07:30:00.000Z');
    expect(service.addNote('x', 'incident', 'Map', 'aar', '2026-10-20T07:30:00.000Z')!.at).toBeUndefined();
    expect(service.notes().filter(n => n.kind === 'activity').length).toBe(2);
  });

  // E-221
  it('deleteWhere removes only the notes the predicate accepts, and leaves the rest', () => {
    const service = TestBed.inject(AarNoteService);
    service.addNote('about the incident', 'incident', 'Map');
    service.addNote('about the app', 'app', 'Map');
    service.addNote('Shift change', 'incident', 'Map', 'activity');

    service.deleteWhere(n => n.kind === 'aar' && n.about === 'app');
    expect(service.notes().map(n => n.text)).toEqual(['about the incident', 'Shift change']);

    service.deleteWhere(() => false);
    expect(service.notes().length).toBe(2);
    service.deleteWhere(n => n.kind === 'activity');
    expect(service.notes().map(n => n.text)).toEqual(['about the incident']);
    expect(JSON.parse(recordStore.getItem('aarNotes')!).notes.length).toBe(1);
  });

  it('reads schema 1 storage as AAR notes', () => {
    recordStore.setItem('aarNotes', JSON.stringify({ schemaVersion: 1, notes: [{ uid: 'a', createdAt: '2026-09-27T10:00:00.000Z', text: 'old', page: 'Map', about: 'incident' }] }));
    expect(TestBed.inject(AarNoteService).notes()[0].kind).toBe('aar');
  });
});
