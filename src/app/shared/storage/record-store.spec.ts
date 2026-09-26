import { DB_NAME, MIGRATED_KEYS, recordStore, STORE } from './record-store';
import { ENCRYPTION_MARKER_KEY } from './record-encryption';

/**
 * E-122 Phase 2a. `recordStore` is a module-level singleton (see its own doc comment for why),
 * so - unlike a fresh `TestBed.inject()` per spec - the SAME instance and the SAME real
 * IndexedDB database carry over between every `it()` in this whole suite (and every other
 * spec file's, within one Karma run). `resetForTests()` is what makes that safe: it clears the
 * in-memory Map, drops the underlying IndexedDB database, and re-arms IndexedDB detection.
 */
describe('RecordStore', () => {
  const KEY = 'record-store-spec-test-key';

  /** Reads a key straight out of IndexedDB, independent of RecordStore's own internals - so
   *  a bug in getItem()/setItem() can't also fool the test that checks what got persisted. */
  function readRawFromIdb(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const openReq = indexedDB.open(DB_NAME);
      // Never CREATE the database from a test read: an empty database with no store would
      // stop RecordStore's own open from running its upgrade. Aborting leaves nothing behind.
      openReq.onupgradeneeded = () => openReq.transaction!.abort();
      openReq.onerror = () => resolve(null);
      openReq.onsuccess = () => {
        const db = openReq.result;
        try {
          // No object store yet (RecordStore's own ensureDb() never ran in this test) means
          // "nothing persisted" - the same as a miss, not a hang or a thrown error.
          if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(null); return; }
          const tx = db.transaction(STORE, 'readonly');
          const getReq = tx.objectStore(STORE).get(key);
          getReq.onsuccess = () => { db.close(); resolve(getReq.result ?? null); };
          getReq.onerror = () => { db.close(); reject(getReq.error); };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
    });
  }

  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  describe('synchronous get/set/remove', () => {
    it('returns null for a key that was never set', () => {
      expect(recordStore.getItem(KEY)).toBeNull();
    });

    it('is readable immediately after setItem(), with no await', () => {
      recordStore.setItem(KEY, 'hello');
      expect(recordStore.getItem(KEY)).toBe('hello');
    });

    it('returns null immediately after removeItem(), with no await', () => {
      recordStore.setItem(KEY, 'hello');
      recordStore.removeItem(KEY);
      expect(recordStore.getItem(KEY)).toBeNull();
    });

    it('persists the written value to IndexedDB once flushed', async () => {
      recordStore.setItem(KEY, 'persisted-value');
      await recordStore.flush();

      expect(await readRawFromIdb(KEY)).toBe('persisted-value');
    });

    it('removes the value from IndexedDB once a removeItem() is flushed', async () => {
      recordStore.setItem(KEY, 'to-be-removed');
      await recordStore.flush();
      expect(await readRawFromIdb(KEY)).toBe('to-be-removed');

      recordStore.removeItem(KEY);
      await recordStore.flush();
      expect(await readRawFromIdb(KEY)).toBeNull();
    });
  });

  describe('coalesced writes', () => {
    it('collapses several synchronous setItem() calls on the same key into one IndexedDB put', async () => {
      const putSpy = spyOn(IDBObjectStore.prototype as any, 'put').and.callThrough();

      recordStore.setItem(KEY, 'v1');
      recordStore.setItem(KEY, 'v2');
      recordStore.setItem(KEY, 'v3');
      // Synchronous readers see the latest value immediately, before anything IndexedDB-side
      // has happened at all - the whole point of the in-memory Map being the source of truth.
      expect(recordStore.getItem(KEY)).toBe('v3');

      await recordStore.flush();

      expect(putSpy).toHaveBeenCalledTimes(1);
      expect(putSpy.calls.argsFor(0)[0]).toBe('v3');
      expect(putSpy.calls.argsFor(0)[1]).toBe(KEY);
      expect(await readRawFromIdb(KEY)).toBe('v3');
    });

    it('coalesces a set immediately followed by a remove down to just the remove', async () => {
      const putSpy = spyOn(IDBObjectStore.prototype as any, 'put').and.callThrough();

      recordStore.setItem(KEY, 'v1');
      recordStore.removeItem(KEY);
      expect(recordStore.getItem(KEY)).toBeNull();

      await recordStore.flush();

      expect(putSpy).not.toHaveBeenCalled();
      expect(await readRawFromIdb(KEY)).toBeNull();
    });
  });

  describe('load() migration from localStorage (E-122 Phase 2a item 4)', () => {
    it('migration happy path: moves a value from localStorage into IndexedDB and clears localStorage', async () => {
      const legacyValue = JSON.stringify({ schemaVersion: 1, rangers: [{ callsign: 'ZZZ1' }] });
      localStorage.setItem('rangers', legacyValue);

      await recordStore.load();

      expect(recordStore.getItem('rangers')).toBe(legacyValue);
      expect(await readRawFromIdb('rangers')).toBe(legacyValue);
      // Only removed after the write was read back and confirmed to match - see below for
      // the case where that verification fails.
      expect(localStorage.getItem('rangers')).toBeNull();
    });

    it('does nothing for a key IndexedDB already has (no re-migration, localStorage already empty)', async () => {
      recordStore.setItem('rangers', 'already-in-idb');
      await recordStore.flush();

      await recordStore.load();

      expect(recordStore.getItem('rangers')).toBe('already-in-idb');
    });

    it('migration failure leaves localStorage untouched: a failed write is never removed from localStorage', async () => {
      const legacyValue = JSON.stringify({ schemaVersion: 1, rangers: [{ callsign: 'ZZZ1' }] });
      localStorage.setItem('rangers', legacyValue);
      spyOn(IDBObjectStore.prototype as any, 'put').and.throwError('simulated IndexedDB write failure');

      await recordStore.load();

      // The session still has the data to work with (never fails to boot)...
      expect(recordStore.getItem('rangers')).toBe(legacyValue);
      // ...but localStorage was never touched, so nothing is lost and the next load() will
      // simply try the migration again.
      expect(localStorage.getItem('rangers')).toBe(legacyValue);
    });

    it('migration failure on read-back mismatch also leaves localStorage untouched', async () => {
      const legacyValue = JSON.stringify({ rangers: [] });
      localStorage.setItem('rangers', legacyValue);

      // The put() genuinely succeeds, but the READ-BACK is corrupted: call #1 is load()'s own
      // "does IndexedDB already have this key" check (must behave for real, on an empty
      // store, or the test never reaches the migration path at all); call #2 is migrateOne()'s
      // read-back after the put(). Overriding just that real request's `.result` - rather than
      // faking the whole IDBRequest/transaction - keeps every event (onsuccess, the owning
      // transaction's oncomplete) firing for real, so only the CONTENT is wrong, not the
      // timing.
      let getCalls = 0;
      const realGet = IDBObjectStore.prototype.get;
      spyOn(IDBObjectStore.prototype as any, 'get').and.callFake(function (this: IDBObjectStore, key: IDBValidKey) {
        getCalls++;
        const req = realGet.call(this, key);
        if (getCalls > 1) {
          Object.defineProperty(req, 'result', { configurable: true, get: () => 'mismatched-content' });
        }
        return req;
      });

      await recordStore.load();

      expect(localStorage.getItem('rangers')).toBe(legacyValue);
      expect(recordStore.getItem('rangers')).toBe(legacyValue);
    });
  });

  describe('recovering from leftover state', () => {
    it('repairs a database that exists without its object store, and still persists writes', async () => {
      await new Promise<void>(resolve => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => { req.result.close(); resolve(); };
      });

      await recordStore.load();
      recordStore.setItem(KEY, 'after-repair');
      await recordStore.flush();

      expect(await readRawFromIdb(KEY)).toBe('after-repair');
    });

    it('removes a stale localStorage copy once IndexedDB already holds the key', async () => {
      recordStore.setItem('rangers', 'live-copy');
      await recordStore.flush();
      localStorage.setItem('rangers', 'stale-plaintext-copy');

      await recordStore.load();

      expect(recordStore.getItem('rangers')).toBe('live-copy');
      expect(localStorage.getItem('rangers')).toBeNull();
    });
  });

  describe('IndexedDB unavailable (E-122 Phase 2a item 5)', () => {
    it('falls back to localStorage for the session, synchronously, and never fails to boot', async () => {
      // `window.indexedDB` is a getter-only accessor (a plain `= undefined` assignment throws
      // in strict mode), so it takes a real property redefinition to simulate a browser/mode
      // where it genuinely does not exist.
      const original = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      try {
        localStorage.setItem('rangers', 'legacy-in-fallback-mode');

        await expectAsync(recordStore.load()).toBeResolved();
        expect(recordStore.getItem('rangers')).toBe('legacy-in-fallback-mode');

        recordStore.setItem('rangers', 'written-in-fallback-mode');
        // No flush() needed - the fallback path writes synchronously.
        expect(localStorage.getItem('rangers')).toBe('written-in-fallback-mode');

        recordStore.removeItem('rangers');
        expect(localStorage.getItem('rangers')).toBeNull();
      } finally {
        if (original) Object.defineProperty(window, 'indexedDB', original);
      }
    });
  });

  describe('returning user (E-122 Phase 2a item 7)', () => {
    it('old-format localStorage data for all managed keys survives load() and moves to IndexedDB', async () => {
      const values: Record<string, string> = {
        rangers: JSON.stringify({ schemaVersion: 1, rangers: [{ callsign: 'RETURNING1' }] }),
        radioLog: JSON.stringify({ version: '1', logEntries: [{ id: 0, callsign: 'RETURNING1' }] }),
        'radioLog-BAD': '{"garbage": true}',
        locations: JSON.stringify({ schemaVersion: 1, locations: [{ name: 'Command Post' }] }),
      };
      for (const key of MIGRATED_KEYS) localStorage.setItem(key, values[key]);

      await recordStore.load();

      for (const key of MIGRATED_KEYS) {
        expect(recordStore.getItem(key)).withContext(`in-memory "${key}"`).toBe(values[key]);
        expect(localStorage.getItem(key)).withContext(`localStorage "${key}"`).toBeNull();
        expect(await readRawFromIdb(key)).withContext(`IndexedDB "${key}"`).toBe(values[key]);
      }
    });
  });

  /**
   * E-122 Phase 2b. Unlike the sections above, these exercise enableEncryption()/
   * disableEncryption()/checkEncryption()/unlock() directly - the plain-DOM form in
   * unlock-form.ts is a thin wrapper around unlock()/eraseEncryptedRecords() and is not
   * itself re-tested here.
   */
  describe('encryption at rest (E-122 Phase 2b)', () => {
    const PASS = 'correct horse battery staple';
    const ROSTER = JSON.stringify({ schemaVersion: 1, rangers: [{ callsign: 'ENC1' }] });
    const RADIO_LOG = JSON.stringify({ version: '1', logEntries: [{ id: 0, callsign: 'ENC1' }] });
    const LOCATIONS = JSON.stringify({ schemaVersion: 1, locations: [{ name: 'Command Post' }] });

    it('reports no encryption on a fresh device', async () => {
      expect(await recordStore.checkEncryption()).toBe(false);
      expect(recordStore.isEncryptionEnabled()).toBe(false);
      expect(recordStore.getEncryptionKey()).toBeUndefined();
    });

    it('enableEncryption() arms a key and marks the device encrypted', async () => {
      expect(recordStore.isEncryptionEnabled()).toBe(false);
      await recordStore.enableEncryption(PASS);
      expect(recordStore.isEncryptionEnabled()).toBe(true);
      expect(recordStore.getEncryptionKey()).toBeDefined();
    });

    it('drain() writes a value that is NOT the plaintext once encryption is enabled', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      await recordStore.flush();

      const raw = await readRawFromIdb('rangers');
      expect(raw).not.toBeNull();
      expect(raw).not.toBe(ROSTER);
      expect(raw as string).not.toContain('ENC1');
      // In memory - what every service actually reads - is still plaintext.
      expect(recordStore.getItem('rangers')).toBe(ROSTER);
    });

    it('locations stay plaintext even while roster/radioLog are encrypted', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      recordStore.setItem('locations', LOCATIONS);
      await recordStore.flush();

      expect(await readRawFromIdb('locations')).toBe(LOCATIONS);
      expect(await readRawFromIdb('rangers')).not.toBe(ROSTER);
    });

    it('verifyPassphrase() rejects the wrong passphrase without touching session state', async () => {
      await recordStore.enableEncryption(PASS);
      const keyBefore = recordStore.getEncryptionKey();

      expect(await recordStore.verifyPassphrase('wrong passphrase')).toBeNull();
      expect(recordStore.getEncryptionKey()).toBe(keyBefore);
      expect(recordStore.isEncryptionEnabled()).toBe(true);
    });

    it('unlock() arms the key on the right passphrase and refuses the wrong one', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      await recordStore.flush();

      // Simulate "next session": drop the in-memory key/marker, but keep IndexedDB, the way
      // a page reload would (nothing here is persisted - see the key field's own comment).
      (recordStore as any).key = undefined;
      (recordStore as any).marker = undefined;

      expect(await recordStore.checkEncryption()).toBe(true);
      expect(await recordStore.unlock('wrong passphrase')).toBe(false);
      expect(recordStore.getEncryptionKey()).toBeUndefined();

      expect(await recordStore.unlock(PASS)).toBe(true);
      expect(recordStore.getEncryptionKey()).toBeDefined();

      // And now load() can actually decrypt what an earlier "session" encrypted.
      await recordStore.load();
      expect(recordStore.getItem('rangers')).toBe(ROSTER);
    });

    it('enable -> disable round trip leaves the data intact and unencrypted again', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      recordStore.setItem('radioLog', RADIO_LOG);
      await recordStore.flush();
      expect(await readRawFromIdb('rangers')).not.toBe(ROSTER);

      const key = await recordStore.verifyPassphrase(PASS);
      expect(key).not.toBeNull();
      await recordStore.disableEncryption();
      await recordStore.flush();

      expect(recordStore.isEncryptionEnabled()).toBe(false);
      expect(recordStore.getEncryptionKey()).toBeUndefined();
      expect(await readRawFromIdb('rangers')).toBe(ROSTER);
      expect(await readRawFromIdb('radioLog')).toBe(RADIO_LOG);
      expect(await readRawFromIdb(ENCRYPTION_MARKER_KEY)).toBeNull();
      // In-memory reads never changed - the Map was always plaintext.
      expect(recordStore.getItem('rangers')).toBe(ROSTER);
    });

    it('one corrupt encrypted record is treated as missing, not a load() failure', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      recordStore.setItem('radioLog', RADIO_LOG);
      await recordStore.flush();

      // Corrupt just the roster's stored ciphertext directly in IndexedDB.
      const raw = JSON.parse((await readRawFromIdb('rangers'))!);
      raw.ciphertext = btoa('not the real ciphertext at all');
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        // Same rule as readRawFromIdb() above: never create the database from a test writer
        // either - the store already exists here (enableEncryption()/flush() created it), so
        // this should never actually fire, but aborting rather than creating keeps this
        // reader/writer safe regardless of ordering.
        req.onupgradeneeded = () => req.transaction!.abort();
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(JSON.stringify(raw), 'rangers');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });

      (recordStore as any).key = undefined;
      (recordStore as any).marker = undefined;
      await recordStore.checkEncryption();
      await recordStore.unlock(PASS);

      await expectAsync(recordStore.load()).toBeResolved();
      // The corrupt key is simply absent, not a thrown error - and the sibling key survives.
      expect(recordStore.getItem('rangers')).toBeNull();
      expect(recordStore.getItem('radioLog')).toBe(RADIO_LOG);
    });

    it('eraseEncryptedRecords() deletes the encrypted keys and the marker, leaving locations alone', async () => {
      await recordStore.enableEncryption(PASS);
      recordStore.setItem('rangers', ROSTER);
      recordStore.setItem('locations', LOCATIONS);
      await recordStore.flush();

      await recordStore.eraseEncryptedRecords();

      expect(recordStore.isEncryptionEnabled()).toBe(false);
      expect(recordStore.getItem('rangers')).toBeNull();
      expect(await readRawFromIdb('rangers')).toBeNull();
      expect(await readRawFromIdb(ENCRYPTION_MARKER_KEY)).toBeNull();
      expect(await readRawFromIdb('locations')).toBe(LOCATIONS);
    });

    it('enableEncryption() throws if already enabled, rather than silently rotating the key', async () => {
      await recordStore.enableEncryption(PASS);
      await expectAsync(recordStore.enableEncryption('a second passphrase')).toBeRejected();
    });

    it('disableEncryption() throws if encryption is not enabled', async () => {
      await expectAsync(recordStore.disableEncryption()).toBeRejected();
    });
  });
});
