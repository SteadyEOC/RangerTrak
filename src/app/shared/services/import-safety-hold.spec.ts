import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import type { AttachmentRef } from '../../domain/attachments'
import { recordStore } from '../storage/record-store'
import { AttachmentStoreService } from './attachment-store.service'
import { ImportSafetyService } from './import-safety.service'
import { RadioLogService } from './radio-log.service'

/** E-198 phase 1 / ADR D-60 item 8 (amended 2026-10-18): the safety copy's live references count as references for every sweep. */
describe('Import safety copy: attachment hold (E-198)', () => {
  let safety: ImportSafetyService
  let store: AttachmentStoreService
  let radioLog: RadioLogService

  const wav = (n = 1) =>
    new File([new Uint8Array([82, 73, 70, 70, n, 2, 3, 4, 5, 6, 7, 8])], `memo${n}.wav`, {
      type: 'audio/wav',
      lastModified: 1700000000000,
    })

  function addEntry(notes: string, attachments: AttachmentRef[] = []) {
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'FERN-1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes,
        ...(attachments.length ? { attachments } : {}),
      })
    )
  }

  const entryCount = () => radioLog.getCurrentRadioLog().logEntries.length

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    store = TestBed.inject(AttachmentStoreService)
    radioLog = TestBed.inject(RadioLogService)
    await store.whenReady()
    await radioLog.deleteAllRadioLogEntries()
    safety = TestBed.inject(ImportSafetyService)
  })

  afterEach(async () => {
    await safety.discard()
    await radioLog.deleteAllRadioLogEntries()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('keeps the bytes a held reference names through a sweep, and frees them once the copy is discarded', async () => {
    const ref = await store.add(wav(1), 'FERN-1')
    addEntry('with a memo', [ref])
    await safety.take('restore', 'a.json')

    // The import replaced the log: nothing live names the memo any more.
    await radioLog.deleteAllRadioLogEntries()
    expect(await store.has(ref.sha256), 'held while the copy exists').toBe(true)
    expect(await store.sweepOrphans([])).toBe(0)
    expect(await store.releaseRemoved([])).toBe(0)
    expect(await store.has(ref.sha256)).toBe(true)

    await safety.discard()
    expect(await store.has(ref.sha256), 'swept after discard').toBe(false)
  })

  it('does not hold a REMOVED reference: its bytes were already released', async () => {
    const ref = await store.add(wav(2), 'FERN-1')
    addEntry('removed memo', [{ ...ref, removed: { at: 'now', by: 'FERN-1' } }])
    await safety.take('restore', 'a.json')

    expect(await store.sweepOrphans([])).toBe(1)
    expect(await store.has(ref.sha256)).toBe(false)
  })

  it('after Undo, the entry is back and so are its photos', async () => {
    const ref = await store.add(wav(3), 'FERN-1')
    addEntry('with a memo', [ref])
    await safety.take('restore', 'a.json')
    await radioLog.deleteAllRadioLogEntries() // the restore replaced the log

    await safety.undo()

    expect(entryCount()).toBe(1)
    expect(await store.has(ref.sha256)).toBe(true)
    expect((await store.getOriginal(ref.sha256)).size).toBe(12)
  })

  it('frees bytes only the replaced copy held, when a new copy replaces it', async () => {
    const ref = await store.add(wav(4), 'FERN-1')
    addEntry('with a memo', [ref])
    await safety.take('restore', 'a.json')
    await radioLog.deleteAllRadioLogEntries()
    expect(await store.has(ref.sha256)).toBe(true)

    await safety.take('report-packet', 'b.txt') // the device now has no entry naming the memo

    expect(await store.has(ref.sha256)).toBe(false)
  })

  it('counts held bytes as kept in the deletion notice, and says when the space comes back for a Restore', async () => {
    const ref = await store.add(wav(5), 'FERN-1')
    addEntry('with a memo', [ref])
    // Before any copy: restoring a file with no entries would delete it.
    expect(await store.deletionNotice([])).toContain('This also deletes 1 attachment')
    expect(await store.deletionNotice([], { keptForSafetyCopy: true })).toContain(
      'freed after 24 hours, or when the safety copy is discarded'
    )

    await safety.take('restore', 'a.json')
    // With a copy holding it, a plain clear deletes nothing.
    expect(await store.deletionNotice([])).toBe('')
  })
})
