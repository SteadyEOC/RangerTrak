import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import type { Mock } from 'vitest'

import { IMPORT_SAFETY_KEY, IMPORT_SAFETY_TTL_MS } from '../../domain/import-safety'
import { isEncryptedEnvelope } from '../storage/record-encryption'
import { DB_NAME, STORE, recordStore } from '../storage/record-store'
import { AttachmentStoreService } from './attachment-store.service'
import { ImportSafetyService, SafetyCopyFailedError } from './import-safety.service'
import { MissionService } from './mission.service'
import { RadioLogService } from './radio-log.service'
import { RangerService } from './ranger.service'

/** The raw value IndexedDB holds for a key, read independently of RecordStore (same idea as record-store.spec.ts). */
function readRawFromIdb(key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME)
    openReq.onupgradeneeded = () => openReq.transaction!.abort()
    openReq.onerror = () => resolve(null)
    openReq.onsuccess = () => {
      const db = openReq.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.close()
        resolve(null)
        return
      }
      const getReq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result ?? null)
      }
      getReq.onerror = () => {
        db.close()
        reject(getReq.error)
      }
    }
  })
}

/** E-198 phase 1: the import safety copy, its storage, Undo, and the attachment hold. */
describe('ImportSafetyService (E-198)', () => {
  let safety: ImportSafetyService
  let store: AttachmentStoreService
  let radioLog: RadioLogService

  function addEntry(notes: string) {
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'FERN-1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes,
      })
    )
  }

  const entryCount = () => radioLog.getCurrentRadioLog().logEntries.length

  async function freshServices() {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    store = TestBed.inject(AttachmentStoreService)
    radioLog = TestBed.inject(RadioLogService)
    await store.whenReady()
    await radioLog.deleteAllRadioLogEntries()
    safety = TestBed.inject(ImportSafetyService)
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    await freshServices()
  })

  afterEach(async () => {
    await safety.discard()
    await radioLog.deleteAllRadioLogEntries()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('has no copy at first, so there is no card', () => {
    expect(safety.last()).toBeNull()
    expect(safety.entriesLostByUndo()).toBe(0)
  })

  it('take() stores the whole device under importSafetyCopy, with what the import was', async () => {
    addEntry('before the import')
    await safety.take('restore', 'rangertrak-Ops-2026-10-17.json')

    const stored = JSON.parse(recordStore.getItem(IMPORT_SAFETY_KEY)!)
    expect(stored.meta.reason).toBe('restore')
    expect(stored.meta.fileName).toBe('rangertrak-Ops-2026-10-17.json')
    expect(stored.meta.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(Date.now() - Date.parse(stored.meta.takenAt)).toBeLessThan(60000)
    expect(stored.payload.schemaVersion).toBe(1)
    expect(stored.payload.radioLog.logEntries.length).toBe(1)
    expect(Array.isArray(stored.payload.rangers)).toBe(true)
    expect(stored.payload.settings).toBeDefined()
    expect(safety.last()?.fileName).toBe('rangertrak-Ops-2026-10-17.json')
    expect(await readRawFromIdb(IMPORT_SAFETY_KEY)).not.toBeNull()
  })

  it('a new import replaces the old copy: one level only', async () => {
    addEntry('one')
    await safety.take('restore', 'first.json')
    addEntry('two')
    await safety.take('report-packet', 'second.txt')

    const stored = JSON.parse(recordStore.getItem(IMPORT_SAFETY_KEY)!)
    expect(stored.meta.fileName).toBe('second.txt')
    expect(stored.payload.radioLog.logEntries.length).toBe(2)
    expect(safety.last()?.reason).toBe('report-packet')
  })

  it('discard() removes the copy and the card', async () => {
    await safety.take('setup-file', 's.zip')
    await safety.discard()

    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBeNull()
    expect(safety.last()).toBeNull()
    expect(await readRawFromIdb(IMPORT_SAFETY_KEY)).toBeNull()
  })

  it('checkExpiry() discards a copy 24 hours after it was taken, and not before', async () => {
    await safety.take('restore', 'a.json')
    const takenAt = Date.parse(safety.last()!.takenAt)

    vi.spyOn(Date, 'now').mockReturnValue(takenAt + IMPORT_SAFETY_TTL_MS - 1000)
    await safety.checkExpiry()
    expect(safety.last()).not.toBeNull()

    ;(Date.now as Mock).mockReturnValue(takenAt + IMPORT_SAFETY_TTL_MS)
    await safety.checkExpiry()
    expect(safety.last()).toBeNull()
    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBeNull()
  })

  it('removes an expired copy when it loads', async () => {
    TestBed.resetTestingModule()
    const stale = {
      meta: {
        takenAt: new Date(Date.now() - IMPORT_SAFETY_TTL_MS - 60000).toISOString(),
        reason: 'restore',
        fileName: 'old.json',
        appVersion: '0.99.56-alpha',
      },
      payload: { radioLog: { logEntries: [] } },
    }
    recordStore.setItem(IMPORT_SAFETY_KEY, JSON.stringify(stale))
    await freshServices()

    expect(safety.last()).toBeNull()
    await safety.discard() // lets the load-time discard finish
    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBeNull()
  })

  it('removes an unreadable copy when it loads', async () => {
    TestBed.resetTestingModule()
    recordStore.setItem(IMPORT_SAFETY_KEY, '{"cut off')
    await freshServices()

    expect(safety.last()).toBeNull()
    await safety.discard()
    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBeNull()
  })

  it('is stored encrypted when device encryption is on: the stored value is an envelope, with no readable roster or log', async () => {
    addEntry('a note naming the Alder Test trailhead')
    await recordStore.enableEncryption('correct horse')

    await safety.take('restore', 'enc.json')
    await recordStore.flush()

    const raw = await readRawFromIdb(IMPORT_SAFETY_KEY)
    expect(raw).not.toBeNull()
    expect(isEncryptedEnvelope(JSON.parse(raw!))).toBe(true)
    expect(raw).not.toContain('Alder Test')
    expect(raw).not.toContain('FERN-1')
    // ...and still reads back plain through the store.
    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toContain('Alder Test')
  })

  it('says so, and leaves the previous copy alone, when the copy cannot be kept', async () => {
    await safety.take('restore', 'good.json')
    const before = recordStore.getItem(IMPORT_SAFETY_KEY)

    recordStore.disableWrites() // another tab holds the writes: setItem() is a no-op
    await expect(safety.take('restore', 'bad.json')).rejects.toThrowError(
      SafetyCopyFailedError
    )

    expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBe(before)
    expect(safety.last()?.fileName).toBe('good.json')
  })

  it('ensureBeforeImport() says kept when it worked', async () => {
    expect(await safety.ensureBeforeImport('report-packet', 'p.txt')).toBe('kept')
    expect(safety.last()?.reason).toBe('report-packet')
  })

  describe('Undo last import', () => {
    it('counts what Undo would lose: the entries logged since the copy', async () => {
      addEntry('kept')
      await safety.take('restore', 'a.json')
      expect(safety.entriesLostByUndo()).toBe(0)
      addEntry('since 1')
      addEntry('since 2')
      expect(safety.entriesLostByUndo()).toBe(2)
    })

    it('does not count the entries the import itself brought in, once markImportDone() ran', async () => {
      addEntry('on the device before')
      await safety.take('report-packet', 'p.txt')
      addEntry('from the packet 1') // the "import"
      addEntry('from the packet 2')
      await safety.markImportDone()
      expect(safety.entriesLostByUndo()).toBe(0)
      addEntry('logged afterwards')
      expect(safety.entriesLostByUndo()).toBe(1)
    })

    it('puts the device back as it was, deletes the copy, and does not take a new one', async () => {
      addEntry('original one')
      addEntry('original two')
      await safety.take('restore', 'a.json')
      // The "import": the log is replaced by something else.
      await radioLog.deleteAllRadioLogEntries()
      addEntry('from the file')
      expect(entryCount()).toBe(1)

      await safety.undo()

      const notes = radioLog
        .getCurrentRadioLog()
        .logEntries.map((e) => e.notes)
        .sort()
      expect(notes).toEqual(['original one', 'original two'])
      expect(safety.last()).toBeNull()
      expect(recordStore.getItem(IMPORT_SAFETY_KEY)).toBeNull()
    })

    it('a roster copy puts back only the roster, and leaves the log and settings alone', async () => {
      const rangers = TestBed.inject(RangerService)
      const mission = TestBed.inject(MissionService)
      const person = (uid: string, callsign: string) => ({
        uid,
        callsign,
        fullName: callsign,
        phone: '',
        image: '',
        team: '',
        role: '',
        note: '',
      })
      rangers.replaceAllRangers([person('u1', 'ORIGINAL')])
      rangers.recordImport('first.csv', 'replace')
      const baselineBefore = rangers.importBaselineRaw()
      addEntry('logged before')

      await safety.take('roster', 'new.csv')
      // The "import": the roster is replaced and re-baselined.
      rangers.replaceAllRangers([person('u2', 'IMPORTED')])
      rangers.recordImport('new.csv', 'replace')
      await safety.markImportDone()
      addEntry('logged after the import')
      mission.updateMission({ ...mission.settings, mission: 'Changed after' })

      expect(safety.entriesLostByUndo()).toBe(0) // a roster Undo never touches the log
      await safety.undo()

      expect(rangers.rangers.map((r) => r.callsign)).toEqual(['ORIGINAL'])
      expect(rangers.importBaselineRaw()).toBe(baselineBefore)
      expect(
        radioLog
          .getCurrentRadioLog()
          .logEntries.map((e) => e.notes)
          .sort()
      ).toEqual(['logged after the import', 'logged before'])
      expect(mission.settings.mission).toBe('Changed after')
      expect(safety.last()).toBeNull()
    })

    it('refuses plainly when there is no copy', async () => {
      await expect(safety.undo()).rejects.toThrowError(/no safety copy/)
    })
  })
})
