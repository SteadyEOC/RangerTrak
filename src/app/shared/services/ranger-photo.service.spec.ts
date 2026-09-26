import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { RANGER_PHOTOS_DB_NAME, RangerPhotoService } from './ranger-photo.service';
import { recordStore } from '../storage/record-store';

/** Reads a value straight out of the photos object store, independent of RangerPhotoService's
 *  own internals - so a bug in put()/loadAll() can't also fool the test that checks what is
 *  actually persisted. Never creates the database (E-122 Phase 2a's lesson, see
 *  record-store.spec.ts's own readRawFromIdb()). */
function readPhotoStoreRaw(stem: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RANGER_PHOTOS_DB_NAME);
    req.onupgradeneeded = () => req.transaction!.abort();
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('photos', 'readonly');
      const getReq = tx.objectStore('photos').get(stem);
      getReq.onsuccess = () => { db.close(); resolve(getReq.result); };
      getReq.onerror = () => { db.close(); reject(getReq.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Photos are operator data held on the device (D-35 / E-38). These pin the behavior that
 * matters in the field: a photo reaches the right ranger, a mismatched file is reported
 * rather than silently dropped, and a ranger with no photo yields no URL so the caller can
 * fall back to the silhouette. D-42 phase 6: matching tries `id` first, `callsign` second,
 * so photo bundles built against the old callsign-only convention still work.
 */
describe('RangerPhotoService', () => {
  const file = (name: string) =>
    new File([new Blob(['not-really-an-image'], { type: 'image/jpeg' })], name, { type: 'image/jpeg' });

  let service: RangerPhotoService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(RangerPhotoService);
    await service.whenReady();
    await service.clear();
  });

  afterEach(async () => {
    await service.clear();
  });

  it('stores a photo against the callsign its filename names', async () => {
    const { stored, unmatched } = await service.importFiles(
      [file('K7VMI.jpg')], [{ callsign: 'K7VMI' }, { id: 'VI-0034' }]);

    expect(stored).toEqual(['K7VMI']);
    expect(unmatched).toEqual([]);
    expect(service.photoUrl({ callsign: 'K7VMI' })).toContain('blob:');
  });

  it('matches the filename to the callsign case-insensitively', async () => {
    // The archive holds both "ke7kdq.jpg" and "K7VMI.jpg" - case is not signal.
    const { stored } = await service.importFiles([file('ke7kdq.JPG')], [{ callsign: 'KE7KDQ' }]);

    expect(stored).toEqual(['KE7KDQ']);
    expect(service.photoUrl({ callsign: 'ke7kdq' })).toContain('blob:');
  });

  it('reports files that match no ranger instead of dropping them silently', async () => {
    const { stored, unmatched } = await service.importFiles(
      [file('K7VMI.jpg'), file('Some_Person.jpg')], [{ callsign: 'K7VMI' }]);

    expect(stored).toEqual(['K7VMI']);
    // The operator has to be told, or they will believe 122 photos loaded when 30 did.
    expect(unmatched).toEqual(['Some_Person.jpg']);
  });

  it('returns no URL for a ranger with no photo, so callers fall back to the silhouette', () => {
    expect(service.photoUrl({ callsign: 'NOBODY' })).toBe('');
  });

  it('survives being asked about an empty or junk ranger', () => {
    expect(service.photoUrl({})).toBe('');
    expect(service.photoUrl({ id: '', callsign: '' })).toBe('');
    expect(service.photoUrl({ callsign: undefined as any })).toBe('');
  });

  it('clear() forgets every photo but is safe to call twice', async () => {
    await service.importFiles([file('K7VMI.jpg')], [{ callsign: 'K7VMI' }]);
    expect(service.count()).toBe(1);

    await service.clear();
    expect(service.count()).toBe(0);
    expect(service.photoUrl({ callsign: 'K7VMI' })).toBe('');

    await service.clear();
    expect(service.count()).toBe(0);
  });

  it('persists across a rebuilt service, which is the whole point of storing them', async () => {
    await service.importFiles([file('VI-0034.jpg')], [{ id: 'VI-0034' }]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    const rebuilt = TestBed.inject(RangerPhotoService);
    await rebuilt.whenReady();

    expect(rebuilt.count()).toBe(1);
    expect(rebuilt.photoUrl({ id: 'VI-0034' })).toContain('blob:');
    await rebuilt.clear();
  });

  // ── D-42 phase 6: id-first, callsign-fallback matching ─────────────────

  it('matches a file named after id even when the ranger also has a callsign', async () => {
    const { stored, unmatched } = await service.importFiles(
      [file('REW-0038.jpg')], [{ id: 'REW-0038', callsign: 'ACS1' }]);

    expect(stored).toEqual(['REW-0038']);
    expect(unmatched).toEqual([]);
    expect(service.photoUrl({ id: 'REW-0038', callsign: 'ACS1' })).toContain('blob:');
  });

  it('falls back to matching by callsign when the file does not match any id - the old build-roster-zip.js convention', async () => {
    const { stored } = await service.importFiles(
      [file('ACS1.jpg')], [{ id: 'REW-0038', callsign: 'ACS1' }]);

    expect(stored).toEqual(['ACS1']);
    // Looked up by the full identity, same as a live component would - the id has no stored
    // photo, but the callsign fallback finds the one filed under the callsign stem.
    expect(service.photoUrl({ id: 'REW-0038', callsign: 'ACS1' })).toContain('blob:');
  });

  it('does not let one ranger\'s callsign match another ranger\'s id', async () => {
    // Guards the priority order itself: if id and callsign maps were merged instead of
    // checked in order, "ACS1" could ambiguously resolve to whichever ranger's entry
    // happened to win the merge.
    const { stored, unmatched } = await service.importFiles(
      [file('ACS1.jpg')], [{ id: 'ACS1' }, { callsign: 'ACS1' }]);

    expect(stored).toEqual(['ACS1']);
    expect(unmatched).toEqual([]);
    // The id match wins - photoUrl() checks id before callsign for the same reason.
    expect(service.photoUrl({ id: 'ACS1' })).toContain('blob:');
  });

  // ── E-122 Phase 2b: photos encrypted under RecordStore's session key ──────
  describe('encryption at rest', () => {
    afterEach(async () => {
      // recordStore is a module-level singleton (see record-store.ts's own doc comment) - it
      // outlives this describe block otherwise and would leak an armed key into every spec
      // file that runs after this one in the same Karma run.
      await recordStore.resetForTests();
    });

    it('stores a newly-imported photo encrypted once RecordStore has a key', async () => {
      await recordStore.enableEncryption('a device passphrase');

      await service.importFiles([file('ENC1.jpg')], [{ callsign: 'ENC1' }]);

      expect(service.photoUrl({ callsign: 'ENC1' })).toContain('blob:');
      const raw = await readPhotoStoreRaw('ENC1');
      expect(raw instanceof Blob).toBe(false);
    });

    it('a rebuilt service decrypts a photo stored encrypted, using the same session key', async () => {
      await recordStore.enableEncryption('a device passphrase');
      await service.importFiles([file('ENC2.jpg')], [{ callsign: 'ENC2' }]);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient()] });
      const rebuilt = TestBed.inject(RangerPhotoService);
      await rebuilt.whenReady();

      expect(rebuilt.photoUrl({ callsign: 'ENC2' })).toContain('blob:');
      await rebuilt.clear();
    });

    it('encryptAll() re-encrypts a photo that was stored before encryption was enabled', async () => {
      await service.importFiles([file('ENC3.jpg')], [{ callsign: 'ENC3' }]);
      expect(await readPhotoStoreRaw('ENC3') instanceof Blob).toBe(true);

      await recordStore.enableEncryption('a device passphrase');
      await service.encryptAll(recordStore.getEncryptionKey()!);

      expect(await readPhotoStoreRaw('ENC3') instanceof Blob).toBe(false);
      // Already-open object URLs are untouched - still readable in this same session.
      expect(service.photoUrl({ callsign: 'ENC3' })).toContain('blob:');
    });

    it('decryptAll() reverses encryptAll(), leaving a plain Blob in the store again', async () => {
      await recordStore.enableEncryption('a device passphrase');
      await service.importFiles([file('ENC4.jpg')], [{ callsign: 'ENC4' }]);
      expect(await readPhotoStoreRaw('ENC4') instanceof Blob).toBe(false);

      await service.decryptAll(recordStore.getEncryptionKey()!);

      expect(await readPhotoStoreRaw('ENC4') instanceof Blob).toBe(true);
    });
  });
});
