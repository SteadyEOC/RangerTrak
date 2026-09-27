import { TestBed } from '@angular/core/testing';

import { AarNoteService } from './aar-note.service';
import { recordStore } from '../storage/record-store';

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

  it('persists through RecordStore under a versioned wrapper', () => {
    const service = TestBed.inject(AarNoteService);
    service.addNote('MGRS field slow to type', 'app', 'Entry');

    const stored = JSON.parse(recordStore.getItem('aarNotes')!);
    expect(stored.schemaVersion).toBe(1);
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
});
