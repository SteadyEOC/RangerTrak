import { provideHttpClient } from '@angular/common/http';
import { encryptJson } from '../crypto/encrypted-file';
import { TestBed } from '@angular/core/testing';

import { BackupService, MissionExport } from './backup.service';
import { RadioLogService } from './radio-log.service';
import { RangerService } from './ranger.service';
import { MissionService } from './mission.service';
// E-122 Phase 2a: the roster (and radio log) now live behind RecordStore, not localStorage
// directly - see that module's own doc comment.
import { recordStore } from '../storage/record-store';

/**
 * Covers PRIVATE-Roadmap.md Section 8/R3 and the Section 12 step 7 DoD literally:
 * "export -> clear storage -> import reproduces the mission exactly."
 */
describe('BackupService', () => {
  const KEYS = ['appSettings', 'rangers', 'radioLog'];

  function configure() {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
  }

  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
    configure();
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  describe('buildExportPayload', () => {
    it('bundles current settings, rangers, and field reports with a schema version', () => {
      const settings = TestBed.inject(MissionService);
      const rangers = TestBed.inject(RangerService);
      const radioLogService = TestBed.inject(RadioLogService);
      const backup = TestBed.inject(BackupService);

      settings.updateMission({ ...settings.settings, mission: 'Export Test Mission' });
      rangers.AddRanger(JSON.stringify({
        callsign: 'EXP1', fullName: 'Export Ranger', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));
      radioLogService.addRadioLogEntry(JSON.stringify({
        callsign: 'EXP1',
        location: { lat: 47.4, lng: -122.4, derivedFromAddress: false },
        date: new Date(), status: 'Normal', notes: 'export test report'
      }));

      const payload = backup.buildExportPayload();

      expect(payload.schemaVersion).toBe(1);
      expect(payload.settings.mission).toBe('Export Test Mission');
      expect(payload.rangers.some(r => r.callsign === 'EXP1')).toBeTrue();
      expect(payload.radioLog.logEntries.some(r => r.notes === 'export test report')).toBeTrue();
      expect((payload.radioLog as any).bounds).toBeUndefined();
      expect(payload.exportedAt).toBeTruthy();
    });
  });

  describe('export -> clear storage -> import round trip', () => {
    it('reproduces the mission exactly after storage is cleared and reloaded', async () => {
      // 1. Build up real mission state.
      const settings = TestBed.inject(MissionService);
      const rangers = TestBed.inject(RangerService);
      const radioLogService = TestBed.inject(RadioLogService);
      const backup = TestBed.inject(BackupService);

      settings.updateMission({ ...settings.settings, mission: 'Roundtrip Mission', event: 'Test Event' });
      rangers.deleteAllRangers();
      rangers.AddRanger(JSON.stringify({
        callsign: 'RT1', fullName: 'Roundtrip Ranger', phone: '',
        image: '', rew: '', team: '', role: '', note: ''
      }));
      radioLogService.deleteAllRadioLogEntries();
      radioLogService.addRadioLogEntry(JSON.stringify({
        callsign: 'RT1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(), status: 'Urgent', notes: 'roundtrip report'
      }));

      // 2. Export.
      const exported: MissionExport = backup.buildExportPayload();

      // 3. Simulate a real "storage wiped" disaster: clear localStorage AND
      // throw away the in-memory service instances, so nothing survives
      // except the exported payload itself - exactly the scenario a mission
      // backup exists to protect against.
      localStorage.clear();
      await recordStore.resetForTests();
      TestBed.resetTestingModule();
      configure();

      const freshSettings = TestBed.inject(MissionService);
      const freshRangers = TestBed.inject(RangerService);
      const freshRadioLogService = TestBed.inject(RadioLogService);
      const freshBackup = TestBed.inject(BackupService);

      // Confirm the "disaster" actually happened: fresh instances do NOT
      // have the roundtrip data (they rebuilt from hardcoded defaults).
      expect(freshSettings.settings.mission).not.toBe('Roundtrip Mission');
      expect(freshRangers.rangers.some(r => r.callsign === 'RT1')).toBeFalse();

      // 4. Import.
      freshBackup.importMission(exported);

      // 5. Reproduces the mission exactly.
      expect(freshSettings.settings.mission).toBe('Roundtrip Mission');
      expect(freshSettings.settings.event).toBe('Test Event');
      expect(freshRangers.rangers.length).toBe(1);
      expect(freshRangers.rangers[0].callsign).toBe('RT1');
      expect(freshRadioLogService.getCurrentRadioLog().logEntries.length).toBe(1);
      expect(freshRadioLogService.getCurrentRadioLog().logEntries[0].notes).toBe('roundtrip report');
      expect(freshRadioLogService.getCurrentRadioLog().logEntries[0].status).toBe('Urgent');

      // Also persisted to localStorage, not just in-memory.
      // ADR D-42/D-43 Phase 2: the roster is stored as a versioned
      // { schemaVersion, rangers } wrapper now, not a bare array.
      const storedRangers = JSON.parse(recordStore.getItem('rangers')!).rangers;
      expect(storedRangers.some((r: any) => r.callsign === 'RT1')).toBeTrue();
      const storedSettings = JSON.parse(localStorage.getItem('appSettings')!);
      expect(storedSettings.mission).toBe('Roundtrip Mission');
    });

    it('recalculates real map bounds after import rather than restoring stale/absent bounds', () => {
      const radioLogService = TestBed.inject(RadioLogService);
      const backup = TestBed.inject(BackupService);

      radioLogService.addRadioLogEntry(JSON.stringify({
        callsign: 'B1',
        location: { lat: 48.0, lng: -121.0, derivedFromAddress: false },
        date: new Date(), status: 'Normal', notes: ''
      }));
      const exported = backup.buildExportPayload();

      backup.importMission(exported);

      const bounds = radioLogService.getCurrentRadioLog().bounds;
      expect(bounds.south).toBeLessThanOrEqual(48.0);
      expect(bounds.north).toBeGreaterThanOrEqual(48.0);
      expect(bounds.west).toBeLessThanOrEqual(-121.0);
      expect(bounds.east).toBeGreaterThanOrEqual(-121.0);
    });
  });

  describe('readFileAsMissionExport', () => {
    it('parses a valid mission export file', async () => {
      const backup = TestBed.inject(BackupService);
      const payload = backup.buildExportPayload();
      const file = new File([JSON.stringify(payload)], 'mission.json', { type: 'application/json' });

      const parsed = await backup.readFileAsMissionExport(file);

      expect(parsed.schemaVersion).toBe(payload.schemaVersion);
      expect(parsed.settings.mission).toBe(payload.settings.mission);
    });

    // E-122 Phase 1. Encryption is OPT-IN: leaving the passphrase blank must keep writing
    // the plain file it always did, and such files must keep importing untouched.
    describe('encrypted backups', () => {
      it('still reads a plain, unencrypted backup - the blank-passphrase case', async () => {
        const backup = TestBed.inject(BackupService);
        const payload = backup.buildExportPayload();
        const file = new File([JSON.stringify(payload)], 'mission.json', { type: 'application/json' });

        // No passphrase callback supplied at all: a plain file must never ask for one.
        const parsed = await backup.readFileAsMissionExport(file);
        expect(parsed.settings.mission).toBe(payload.settings.mission);
      });

      it('round-trips an encrypted backup through the passphrase callback', async () => {
        const backup = TestBed.inject(BackupService);
        const payload = backup.buildExportPayload();
        const envelope = await encryptJson(payload, 'a good passphrase',
          { exportedAt: payload.exportedAt, appVersion: payload.appVersion });
        const file = new File([JSON.stringify(envelope)], 'mission.rtenc.json',
          { type: 'application/json' });

        const parsed = await backup.readFileAsMissionExport(file, () => 'a good passphrase');

        expect(parsed.settings.mission).toBe(payload.settings.mission);
        expect(parsed.rangers.length).toBe(payload.rangers.length);
      });

      it('passes the plaintext hint to the prompt, so the file is identifiable while locked', async () => {
        const backup = TestBed.inject(BackupService);
        const payload = backup.buildExportPayload();
        const envelope = await encryptJson(payload, 'pw', { exportedAt: '2026-09-22', appVersion: '0.93.0' });
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', { type: 'application/json' });

        let seen: any = null;
        await backup.readFileAsMissionExport(file, hint => { seen = hint; return 'pw'; });
        expect(seen?.exportedAt).toBe('2026-09-22');
        expect(seen?.appVersion).toBe('0.93.0');
      });

      it('fails clearly on the wrong passphrase instead of applying garbage', async () => {
        const backup = TestBed.inject(BackupService);
        const envelope = await encryptJson(backup.buildExportPayload(), 'right');
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', { type: 'application/json' });

        await expectAsync(backup.readFileAsMissionExport(file, () => 'wrong')).toBeRejected();
      });

      it('treats a cancelled prompt as a cancelled restore, not a corrupt file', async () => {
        const backup = TestBed.inject(BackupService);
        const envelope = await encryptJson(backup.buildExportPayload(), 'pw');
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', { type: 'application/json' });

        await expectAsync(backup.readFileAsMissionExport(file, () => null))
          .toBeRejectedWithError(/Cancelled/);
      });
    });

    it('rejects a file that is not valid JSON', async () => {
      const backup = TestBed.inject(BackupService);
      const file = new File(['not json{{{'], 'bad.json', { type: 'application/json' });

      await expectAsync(backup.readFileAsMissionExport(file)).toBeRejected();
    });

    it('rejects a file missing required top-level keys', async () => {
      const backup = TestBed.inject(BackupService);
      const file = new File([JSON.stringify({ schemaVersion: 1 })], 'incomplete.json', { type: 'application/json' });

      await expectAsync(backup.readFileAsMissionExport(file)).toBeRejected();
    });

    it('rejects a file where rangers is not an array', async () => {
      const backup = TestBed.inject(BackupService);
      const bad = { schemaVersion: 1, settings: {}, rangers: 'not-an-array', radioLog: { logEntries: [] } };
      const file = new File([JSON.stringify(bad)], 'bad-rangers.json', { type: 'application/json' });

      await expectAsync(backup.readFileAsMissionExport(file)).toBeRejected();
    });
  });

  describe('importMission validation', () => {
    it('throws on a structurally invalid payload rather than partially applying it', async () => {
      const settings = TestBed.inject(MissionService);
      const backup = TestBed.inject(BackupService);
      const missionBefore = settings.settings.mission;

      // E-122 Phase 2a: importMission() is `async` now (it awaits recordStore.flush() at the
      // end), so a synchronous throw inside it surfaces as a REJECTED PROMISE, not a thrown
      // exception a plain `expect(() => ...).toThrow()` can catch.
      await expectAsync(backup.importMission({ mission: 'nope' } as any)).toBeRejected();
      expect(settings.settings.mission).toBe(missionBefore);
    });
  });
});
