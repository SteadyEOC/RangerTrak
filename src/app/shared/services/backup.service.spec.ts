import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { buildCorpus } from '../../../testing/import-corpus/corpus'
import { encryptBytes, encryptJson } from '../crypto/encrypted-file'
import { buildHandoverFile } from '../export/handover-file'

import { verifyJournal } from '../../domain/mission-journal'
import { AarNoteService } from './aar-note.service'
import { ActivityLogHeaderService } from './activity-log-header.service'
import { BackupService, MissionExport } from './backup.service'
import { DevicePrefsService } from './device-prefs.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerPhotoService } from './ranger-photo.service'
import { RangerService } from './ranger.service'
// E-122 Phase 2a: the roster (and radio log) now live behind RecordStore, not localStorage
// directly - see that module's own doc comment.
import { activeDemoScenario, setActiveDemoScenario } from '../mapping/demo-map'
import { recordStore } from '../storage/record-store'

/**
 * Covers PRIVATE-Roadmap.md Section 8/R3 and the Section 12 step 7 DoD literally:
 * "export -> clear storage -> import reproduces the mission exactly."
 */
describe('BackupService', () => {
  const KEYS = ['appSettings', 'rangers', 'radioLog']

  function configure() {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    configure()
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
  })

  describe('buildExportPayload', () => {
    it('bundles current settings, rangers, and radio log entries with a schema version', async () => {
      const settings = TestBed.inject(MissionService)
      const rangers = TestBed.inject(RangerService)
      const radioLogService = TestBed.inject(RadioLogService)
      const backup = TestBed.inject(BackupService)

      settings.updateMission({ ...settings.settings, mission: 'Export Test Mission' })
      rangers.AddRanger(
        JSON.stringify({
          callsign: 'EXP1',
          fullName: 'Export Ranger',
          phone: '',
          image: '',
          rew: '',
          team: '',
          role: '',
          note: '',
        })
      )
      radioLogService.addRadioLogEntry(
        JSON.stringify({
          callsign: 'EXP1',
          location: { lat: 47.4, lng: -122.4, derivedFromAddress: false },
          date: new Date(),
          status: 'Normal',
          notes: 'export test report',
        })
      )

      const payload = await backup.buildExportPayload()

      expect(payload.schemaVersion).toBe(1)
      expect(payload.settings.mission).toBe('Export Test Mission')
      expect(payload.rangers.some((r) => r.callsign === 'EXP1')).toBe(true)
      expect(
        payload.radioLog.logEntries.some((r) => r.notes === 'export test report')
      ).toBe(true)
      expect((payload.radioLog as any).bounds).toBeUndefined()
      expect(payload.exportedAt).toBeTruthy()
    })
  })

  describe('station letter (E-220, D-68)', () => {
    it('is carried by a backup, and a restore puts it back on the device', async () => {
      const prefs = new DevicePrefsService()
      prefs.setMsgStation('D')
      const backup = TestBed.inject(BackupService)
      const payload = await backup.buildExportPayload()
      expect(payload.devicePrefs).toEqual({ msgStation: 'D' })

      localStorage.removeItem('rt-msg-station')
      expect(prefs.getMsgStation()).toBe('A')
      await backup.importMission(JSON.parse(JSON.stringify(payload)))
      expect(prefs.getMsgStation()).toBe('D')
    })

    it('is left alone by a backup made before it existed', async () => {
      const prefs = new DevicePrefsService()
      prefs.setMsgStation('E')
      const backup = TestBed.inject(BackupService)
      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      delete payload.devicePrefs

      await backup.importMission(payload)
      expect(prefs.getMsgStation()).toBe('E')
    })
  })

  describe('export -> clear storage -> import round trip', () => {
    it('reproduces the mission exactly after storage is cleared and reloaded', async () => {
      // 1. Build up real mission state.
      const settings = TestBed.inject(MissionService)
      const rangers = TestBed.inject(RangerService)
      const radioLogService = TestBed.inject(RadioLogService)
      const backup = TestBed.inject(BackupService)

      settings.updateMission({
        ...settings.settings,
        mission: 'Roundtrip Mission',
        event: 'Test Event',
      })
      rangers.deleteAllRangers()
      rangers.AddRanger(
        JSON.stringify({
          callsign: 'RT1',
          fullName: 'Roundtrip Ranger',
          phone: '',
          image: '',
          rew: '',
          team: '',
          role: '',
          note: '',
        })
      )
      radioLogService.deleteAllRadioLogEntries()
      radioLogService.addRadioLogEntry(
        JSON.stringify({
          callsign: 'RT1',
          location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
          date: new Date(),
          status: 'Urgent',
          notes: 'roundtrip report',
        })
      )

      // 2. Export.
      const exported: MissionExport = await backup.buildExportPayload()

      // 3. Simulate a real "storage wiped" disaster: clear localStorage AND
      // throw away the in-memory service instances, so nothing survives
      // except the exported payload itself - exactly the scenario a mission
      // backup exists to protect against.
      localStorage.clear()
      await recordStore.resetForTests()
      TestBed.resetTestingModule()
      configure()

      const freshSettings = TestBed.inject(MissionService)
      const freshRangers = TestBed.inject(RangerService)
      const freshRadioLogService = TestBed.inject(RadioLogService)
      const freshBackup = TestBed.inject(BackupService)

      // Confirm the "disaster" actually happened: fresh instances do NOT
      // have the roundtrip data (they rebuilt from hardcoded defaults).
      expect(freshSettings.settings.mission).not.toBe('Roundtrip Mission')
      expect(freshRangers.rangers.some((r) => r.callsign === 'RT1')).toBe(false)

      // 4. Import.
      await freshBackup.importMission(exported)

      // 5. Reproduces the mission exactly.
      expect(freshSettings.settings.mission).toBe('Roundtrip Mission')
      expect(freshSettings.settings.event).toBe('Test Event')
      expect(freshRangers.rangers.length).toBe(1)
      expect(freshRangers.rangers[0].callsign).toBe('RT1')
      expect(freshRadioLogService.getCurrentRadioLog().logEntries.length).toBe(1)
      expect(freshRadioLogService.getCurrentRadioLog().logEntries[0].notes).toBe(
        'roundtrip report'
      )
      expect(freshRadioLogService.getCurrentRadioLog().logEntries[0].status).toBe(
        'Urgent'
      )

      // Also persisted to localStorage, not just in-memory.
      // ADR D-42/D-43 Phase 2: the roster is stored as a versioned
      // { schemaVersion, rangers } wrapper now, not a bare array.
      const storedRangers = JSON.parse(recordStore.getItem('rangers')!).rangers
      expect(storedRangers.some((r: any) => r.callsign === 'RT1')).toBe(true)
      const storedSettings = JSON.parse(localStorage.getItem('appSettings')!)
      expect(storedSettings.mission).toBe('Roundtrip Mission')
    })

    it('E-126: restoring an older-format backup (settings schema v4) migrates it on the way in', async () => {
      const backup = TestBed.inject(BackupService)
      const missionService = TestBed.inject(MissionService)
      const exported = await backup.buildExportPayload()
      const old = {
        ...exported,
        settings: {
          ...exported.settings,
          schemaVersion: 4,
          allowManualPinDrops: true,
        } as any,
      }

      await backup.importMission(old)

      expect(missionService.settings.schemaVersion).toBe(5)
      expect('allowManualPinDrops' in missionService.settings).toBe(false)
    })

    it('E-124: a restored mission is not a demo - the demo marker is cleared', async () => {
      const backup = TestBed.inject(BackupService)
      setActiveDemoScenario('grand-canyon')
      await backup.importMission(await backup.buildExportPayload())
      expect(activeDemoScenario()).toBeNull()
    })

    it('recalculates real map bounds after import rather than restoring stale/absent bounds', async () => {
      const radioLogService = TestBed.inject(RadioLogService)
      const backup = TestBed.inject(BackupService)

      radioLogService.addRadioLogEntry(
        JSON.stringify({
          callsign: 'B1',
          location: { lat: 48.0, lng: -121.0, derivedFromAddress: false },
          date: new Date(),
          status: 'Normal',
          notes: '',
        })
      )
      const exported = await backup.buildExportPayload()

      await backup.importMission(exported)

      const bounds = radioLogService.getCurrentRadioLog().bounds
      expect(bounds.south).toBeLessThanOrEqual(48.0)
      expect(bounds.north).toBeGreaterThanOrEqual(48.0)
      expect(bounds.west).toBeLessThanOrEqual(-121.0)
      expect(bounds.east).toBeGreaterThanOrEqual(-121.0)
    })
  })

  describe('readFileAsMissionExport', () => {
    it('parses a valid mission export file', async () => {
      const backup = TestBed.inject(BackupService)
      const payload = await backup.buildExportPayload()
      const file = new File([JSON.stringify(payload)], 'mission.json', {
        type: 'application/json',
      })

      const parsed = await backup.readFileAsMissionExport(file)

      expect(parsed.schemaVersion).toBe(payload.schemaVersion)
      expect(parsed.settings.mission).toBe(payload.settings.mission)
    })

    // E-122 Phase 1. Encryption is OPT-IN: leaving the passphrase blank must keep writing
    // the plain file it always did, and such files must keep importing untouched.
    describe('encrypted backups', () => {
      it('still reads a plain, unencrypted backup - the blank-passphrase case', async () => {
        const backup = TestBed.inject(BackupService)
        const payload = await backup.buildExportPayload()
        const file = new File([JSON.stringify(payload)], 'mission.json', {
          type: 'application/json',
        })

        // No passphrase callback supplied at all: a plain file must never ask for one.
        const parsed = await backup.readFileAsMissionExport(file)
        expect(parsed.settings.mission).toBe(payload.settings.mission)
      })

      it('points an encrypted hand-over to Radio Log before asking for a passphrase', async () => {
        const backup = TestBed.inject(BackupService)
        const handover = await buildHandoverFile({
          mission: 'M',
          event: '',
          opPeriod: '',
          appVersion: 't',
          rangers: [],
          locations: [],
          entries: [],
          photos: [],
          passphrase: 'pw',
        })
        const file = new File([handover.bytes as BlobPart], handover.filename, {
          type: 'application/json',
        })
        const ask = vi.fn().mockName('ask').mockReturnValue('pw')
        await expect(backup.readFileAsMissionExport(file, ask)).rejects.toThrowError(
          /scribe hand-over file/
        )
        expect(ask).not.toHaveBeenCalled()
      })

      it('recognises a hand-over with no kind (0.99.38) by its zip payload, not as a wrong passphrase', async () => {
        const backup = TestBed.inject(BackupService)
        const handover = await buildHandoverFile({
          mission: 'M',
          event: '',
          opPeriod: '',
          appVersion: 't',
          rangers: [],
          locations: [],
          entries: [],
          photos: [],
        })
        const envelope = await encryptBytes(
          handover.bytes as Uint8Array<ArrayBuffer>,
          'pw'
        )
        const file = new File([JSON.stringify(envelope)], 'old.rtenc.json', {
          type: 'application/json',
        })
        await expect(
          backup.readFileAsMissionExport(file, () => 'pw')
        ).rejects.toThrowError(/scribe hand-over file/)
      })

      it('round-trips an encrypted backup through the passphrase callback', async () => {
        const backup = TestBed.inject(BackupService)
        const payload = await backup.buildExportPayload()
        const envelope = await encryptJson(payload, 'a good passphrase', {
          exportedAt: payload.exportedAt,
          appVersion: payload.appVersion,
        })
        const file = new File([JSON.stringify(envelope)], 'mission.rtenc.json', {
          type: 'application/json',
        })

        const parsed = await backup.readFileAsMissionExport(
          file,
          () => 'a good passphrase'
        )

        expect(parsed.settings.mission).toBe(payload.settings.mission)
        expect(parsed.rangers.length).toBe(payload.rangers.length)
      })

      it('passes the plaintext hint to the prompt, so the file is identifiable while locked', async () => {
        const backup = TestBed.inject(BackupService)
        const payload = await backup.buildExportPayload()
        const envelope = await encryptJson(payload, 'pw', {
          exportedAt: '2026-09-22',
          appVersion: '0.93.0',
        })
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', {
          type: 'application/json',
        })

        let seen: any = null
        await backup.readFileAsMissionExport(file, (hint) => {
          seen = hint
          return 'pw'
        })
        expect(seen?.exportedAt).toBe('2026-09-22')
        expect(seen?.appVersion).toBe('0.93.0')
      })

      it('fails clearly on the wrong passphrase instead of applying garbage', async () => {
        const backup = TestBed.inject(BackupService)
        const envelope = await encryptJson(await backup.buildExportPayload(), 'right')
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', {
          type: 'application/json',
        })

        await expect(
          backup.readFileAsMissionExport(file, () => 'wrong')
        ).rejects.toThrow()
      })

      it('treats a cancelled prompt as a cancelled restore, not a corrupt file', async () => {
        const backup = TestBed.inject(BackupService)
        const envelope = await encryptJson(await backup.buildExportPayload(), 'pw')
        const file = new File([JSON.stringify(envelope)], 'm.rtenc.json', {
          type: 'application/json',
        })

        await expect(
          backup.readFileAsMissionExport(file, () => null)
        ).rejects.toThrowError(/Cancelled/)
      })
    })

    it('rejects a file that is not valid JSON', async () => {
      const backup = TestBed.inject(BackupService)
      const file = new File(['not json{{{'], 'bad.json', { type: 'application/json' })

      await expect(backup.readFileAsMissionExport(file)).rejects.toThrow()
    })

    it('rejects a file missing required top-level keys', async () => {
      const backup = TestBed.inject(BackupService)
      const file = new File([JSON.stringify({ schemaVersion: 1 })], 'incomplete.json', {
        type: 'application/json',
      })

      await expect(backup.readFileAsMissionExport(file)).rejects.toThrow()
    })

    it('rejects a file where rangers is not an array', async () => {
      const backup = TestBed.inject(BackupService)
      const bad = {
        schemaVersion: 1,
        settings: {},
        rangers: 'not-an-array',
        radioLog: { logEntries: [] },
      }
      const file = new File([JSON.stringify(bad)], 'bad-rangers.json', {
        type: 'application/json',
      })

      await expect(backup.readFileAsMissionExport(file)).rejects.toThrow()
    })
  })

  describe('plain-language errors for a mangled file (E-198)', () => {
    const corpusFile = (name: string) => {
      const f = buildCorpus().find((c) => c.name === name)!
      return new File([f.bytes as BlobPart], f.name)
    }
    const reject = (name: string) =>
      TestBed.inject(BackupService)
        .readFileAsMissionExport(corpusFile(name))
        .then(
          () => {
            throw new Error(`${name} should have been refused`)
          },
          (e: Error) => e.message
        )

    it('reads a backup with a byte order mark as the backup it is', async () => {
      const payload = await TestBed.inject(BackupService).readFileAsMissionExport(
        corpusFile('backup-with-bom.json')
      )
      expect(payload.settings.mission).toBe('Fernhollow Drill')
    })

    it('says a truncated backup is cut off, at 10, 50 and 95 percent', async () => {
      for (const name of [
        'backup-truncated-10.json',
        'backup-truncated-50.json',
        'backup-truncated-95.json',
      ]) {
        expect(await reject(name), name).toContain('This file is cut off')
      }
    })

    it('says a hand-edited backup is damaged or edited by hand, and a newer one needs an update', async () => {
      expect(await reject('backup-hand-edited.json')).toContain(
        'damaged or was edited by hand'
      )
      expect(await reject('backup-newer-schema.json')).toBe(
        'Made by a newer RangerTrak. Update this device first.'
      )
    })

    it('names the right place for a Report Packet, a spreadsheet and random bytes', async () => {
      expect(await reject('report-packet.txt')).toContain('Report Packet')
      expect(await reject('roster.csv')).toContain('Rangers > Import')
      expect(await reject('random.bin')).toBe("This isn't a RangerTrak file.")
    })

    it('refuses a Setup file or spreadsheet zip at the picker, in plain words, and still takes an attachments zip', async () => {
      const backup = TestBed.inject(BackupService)
      await expect(
        backup.classifyRestoreFile(corpusFile('setup-file.zip'))
      ).rejects.toThrowError(/Mission > Setup files/)
      await expect(
        backup.classifyRestoreFile(corpusFile('roster.xlsx'))
      ).rejects.toThrowError(/spreadsheet/)
      expect(await backup.classifyRestoreFile(corpusFile('attachments.zip'))).toBe(
        'attachments'
      )
      expect(await backup.classifyRestoreFile(corpusFile('backup-with-bom.json'))).toBe(
        'backup'
      )
    })
  })

  describe('importMission validation', () => {
    it('throws on a structurally invalid payload rather than partially applying it', async () => {
      const settings = TestBed.inject(MissionService)
      const backup = TestBed.inject(BackupService)
      const missionBefore = settings.settings.mission

      // E-122 Phase 2a: importMission() is `async` now (it awaits recordStore.flush() at the
      // end), so a synchronous throw inside it surfaces as a REJECTED PROMISE, not a thrown
      // exception a plain `expect(() => ...).toThrow()` can catch.
      await expect(backup.importMission({ mission: 'nope' } as any)).rejects.toThrow()
      expect(settings.settings.mission).toBe(missionBefore)
    })
  })
  describe('After Action notes (E-116)', () => {
    it('carries notes through a backup and restore', async () => {
      const notes = TestBed.inject(AarNoteService)
      const backup = TestBed.inject(BackupService)
      notes.addNote('Relay point out of range', 'incident', 'Map')

      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      expect(payload.aarNotes.length).toBe(1)

      notes.deleteAllNotes()
      await backup.importMission(payload)
      expect(notes.notes().map((n) => n.text)).toEqual(['Relay point out of range'])
    })

    it('restores a backup made before notes existed, with none', async () => {
      const notes = TestBed.inject(AarNoteService)
      const backup = TestBed.inject(BackupService)
      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      delete payload.aarNotes

      notes.addNote('left over from another mission', 'incident', 'Entry')
      await backup.importMission(payload)
      expect(notes.notes()).toEqual([])
    })
  })
  describe('ICS-214 lines and header (E-04 / D-63)', () => {
    it('carries activity lines with the notes, and the header, through a backup and restore', async () => {
      const notes = TestBed.inject(AarNoteService)
      const header = TestBed.inject(ActivityLogHeaderService)
      const backup = TestBed.inject(BackupService)
      notes.addNote(
        'Net opened',
        'incident',
        'Entry',
        'activity',
        '2026-10-20T07:30:00.000Z'
      )
      header.save({
        name: 'Pat Doe',
        icsPosition: 'Radio Operator',
        resources: [{ name: 'Sam', icsPosition: 'Runner', homeAgency: 'CERT' }],
      })

      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      expect(payload.aarNotes[0].kind).toBe('activity')
      expect(payload.activityLogHeader.name).toBe('Pat Doe')

      notes.deleteAllNotes()
      header.clear()
      await backup.importMission(payload)
      expect(notes.notes()[0].kind).toBe('activity')
      expect(notes.notes()[0].at).toBe('2026-10-20T07:30:00.000Z')
      expect(header.header().name).toBe('Pat Doe')
      expect(header.header().resources.length).toBe(1)
    })

    it('leaves the device header alone when the backup has none (an older version)', async () => {
      const header = TestBed.inject(ActivityLogHeaderService)
      const backup = TestBed.inject(BackupService)
      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      delete payload.activityLogHeader

      header.save({ name: 'Kept' })
      await backup.importMission(payload)
      expect(header.header().name).toBe('Kept')
    })
  })
  describe('mission journal (E-222 / D-67)', () => {
    it('puts a copy of the journal in the export, including the backup entry itself', async () => {
      const journal = TestBed.inject(MissionJournalService)
      const backup = TestBed.inject(BackupService)
      journal.record('demo-loaded', 'Loaded a demo.')

      const blobs: Blob[] = []
      vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
        blobs.push(b as Blob)
        return 'blob:test'
      })
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined)
      await backup.exportMission()

      const payload: MissionExport = JSON.parse(await blobs[0].text())
      expect(payload.journal!.count).toBe(2)
      expect(payload.journal!.entries.map((e) => e.action)).toEqual([
        'demo-loaded',
        'backup-exported',
      ])
      expect(payload.journal!.head).toBe(payload.journal!.entries[1].hash)
      expect(verifyJournal(payload.journal!.entries).ok).toBe(true)
    })

    it('restore keeps the device journal, ignores the backup journal, and the caller adds one entry', async () => {
      const journal = TestBed.inject(MissionJournalService)
      const backup = TestBed.inject(BackupService)
      journal.record('print-309', 'Device entry one.')
      const payload: MissionExport = JSON.parse(
        JSON.stringify(await backup.buildExportPayload())
      )
      expect(backup.describeBackupJournal(payload)).toMatch(
        /^jrnl [0-9a-f]{4}·[0-9a-f]{4} \(1\)$/
      )

      journal.record('print-309', 'Device entry two, after the backup.')
      await backup.importMission(payload)
      expect(journal.entries().map((e) => e.summary)).toEqual([
        'Device entry one.',
        'Device entry two, after the backup.',
      ])

      journal.record(
        'mission-restored',
        `Restored the mission from x.json. The backup's journal: ${backup.describeBackupJournal(payload)}.`
      )
      expect(journal.entries().length).toBe(3)
      expect(journal.verify().ok).toBe(true)
    })

    it('reads a backup made before the journal as having none', async () => {
      const backup = TestBed.inject(BackupService)
      const payload = JSON.parse(JSON.stringify(await backup.buildExportPayload()))
      delete payload.journal
      expect(backup.describeBackupJournal(payload)).toBe('none')
      await backup.importMission(payload)
    })
  })

  describe('geocoding key and photos (2026-10-01, John)', () => {
    const KEY = 'AIza-test-key'

    function pngBlob(): Blob {
      // 1x1 transparent PNG
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: 'image/png' })
    }

    it('strips the key from a plain payload but keeps it in a passphrase-protected one', async () => {
      const mission = TestBed.inject(MissionService)
      const backup = TestBed.inject(BackupService)
      mission.updateMission({ ...mission.settings, googleGeocodingApiKey: KEY })
      expect((await backup.buildExportPayload()).settings.googleGeocodingApiKey).toBe('')
      expect((await backup.buildExportPayload(true)).settings.googleGeocodingApiKey).toBe(
        KEY
      )
      // the live settings are untouched by the strip
      expect(mission.settings.googleGeocodingApiKey).toBe(KEY)
    })

    it('keeps the device key when the restored backup has none', async () => {
      const mission = TestBed.inject(MissionService)
      const backup = TestBed.inject(BackupService)
      mission.updateMission({ ...mission.settings, googleGeocodingApiKey: KEY })
      const plain = await backup.buildExportPayload()
      await backup.importMission(plain)
      expect(mission.settings.googleGeocodingApiKey).toBe(KEY)
    })

    it('keeps the Board password out of a plain payload and a plain restore (D-61)', async () => {
      const mission = TestBed.inject(MissionService)
      const backup = TestBed.inject(BackupService)
      const PW = 'board-pw-test'
      mission.updateMission({ ...mission.settings, boardPassword: PW })
      expect((await backup.buildExportPayload()).settings.boardPassword).toBe('')
      expect((await backup.buildExportPayload(true)).settings.boardPassword).toBe(PW)
      await backup.importMission(await backup.buildExportPayload())
      expect(mission.settings.boardPassword).toBe(PW)
    })

    it('stores the Board password in secrets beside the geocoding key, not in appSettings (D-61)', async () => {
      const mission = TestBed.inject(MissionService)
      const PW = 'board-pw-test'
      mission.updateMission({
        ...mission.settings,
        googleGeocodingApiKey: KEY,
        boardPassword: PW,
      })
      expect(localStorage.getItem('appSettings')).not.toContain(PW)
      const secrets = JSON.parse(recordStore.getItem('secrets')!)
      expect(secrets.boardPassword).toBe(PW)
      expect(secrets.googleGeocodingApiKey).toBe(KEY)
    })

    it('stores the key in secrets, not in appSettings', async () => {
      const mission = TestBed.inject(MissionService)
      mission.updateMission({ ...mission.settings, googleGeocodingApiKey: KEY })
      expect(localStorage.getItem('appSettings')).not.toContain(KEY)
      expect(recordStore.getItem('secrets')).toContain(KEY)
    })

    it('migrates a key still in appSettings into secrets on load', async () => {
      const seed = TestBed.inject(MissionService)
      const legacy = { ...seed.settings, googleGeocodingApiKey: KEY }
      TestBed.resetTestingModule()
      configure()
      localStorage.setItem('appSettings', JSON.stringify(legacy))
      recordStore.removeItem('secrets')
      const mission = TestBed.inject(MissionService)
      expect(mission.settings.googleGeocodingApiKey).toBe(KEY)
      expect(localStorage.getItem('appSettings')).not.toContain(KEY)
      expect(recordStore.getItem('secrets')).toContain(KEY)
    })

    it('round-trips photos, and an older payload without photos leaves them alone', async () => {
      const rangers = TestBed.inject(RangerService)
      const photos = TestBed.inject(RangerPhotoService)
      const backup = TestBed.inject(BackupService)
      rangers.AddRanger(
        JSON.stringify({
          callsign: 'PH1',
          fullName: 'Photo Ranger',
          phone: '',
          image: '',
          rew: '',
          team: '',
          role: '',
          note: '',
        })
      )
      await photos.importFiles(
        [new File([pngBlob()], 'PH1.png', { type: 'image/png' })],
        rangers.rangers
      )
      expect(photos.count()).toBe(1)

      const payload = await backup.buildExportPayload()
      expect(payload.photos?.length).toBe(1)
      expect(payload.photos![0].stem).toBe('PH1')

      await photos.clear()
      expect(photos.count()).toBe(0)
      await backup.importMission(payload)
      expect(photos.count()).toBe(1)

      const older = JSON.parse(JSON.stringify(payload))
      delete older.photos
      await backup.importMission(older)
      expect(photos.count()).toBe(1)

      await backup.importMission({ ...payload, photos: [] })
      expect(photos.count()).toBe(0)
    })
  })
})
