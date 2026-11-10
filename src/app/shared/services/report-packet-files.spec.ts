import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import type { AttachmentRef } from '../../domain/attachments'
import { recordStore } from '../storage/record-store'
import { AttachmentStoreService } from './attachment-store.service'
import { RadioLogService } from './radio-log.service'

/**
 * E-194 / ADR D-60 item 6: a Report Packet's originals travel as loose files beside the .txt and
 * are stored on the other side only when their fingerprint matches a live reference there.
 */
describe('Report Packet with files (E-194)', () => {
  let store: AttachmentStoreService
  let radioLog: RadioLogService

  const bytesA = new Uint8Array([1, 2, 3, 4, 5])
  const bytesB = new Uint8Array([9, 8, 7, 6])
  const fileA = () => new File([bytesA], 'IMG_0001.jpg', { type: 'image/jpeg' })
  const fileB = () => new File([bytesB], 'IMG_0001.jpg', { type: 'image/jpeg' }) // same name, other photo

  function addEntry(refs: AttachmentRef[]) {
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'RT1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes: 'with photos',
        attachments: refs,
      })
    )
  }

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    store = TestBed.inject(AttachmentStoreService)
    radioLog = TestBed.inject(RadioLogService)
    await store.whenReady()
    await radioLog.deleteAllRadioLogEntries()
  })

  afterEach(async () => {
    await radioLog.deleteAllRadioLogEntries()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('shares the originals this device holds, with distinct names', async () => {
    const a = await store.add(fileA(), 'K7ABC')
    const b = await store.add(fileB(), 'K7ABC')
    addEntry([a, b])

    const media = await radioLog.reportPacketMedia()

    expect(media.length).toBe(2)
    expect(new Set(media.map((f) => f.name)).size).toBe(2)
    expect(new Uint8Array(await media[0].arrayBuffer())).toEqual(bytesA)
  })

  it('leaves out a reference whose bytes are on another device', async () => {
    const a = await store.add(fileA(), 'K7ABC')
    await store.remove(a.sha256)
    addEntry([a])

    expect(await radioLog.reportPacketMedia()).toEqual([])
  })

  it('stores a matching file, ignores a stray one, and counts what is still elsewhere', async () => {
    const a = await store.add(fileA(), 'K7ABC')
    const b = await store.add(fileB(), 'K7ABC')
    await store.remove(a.sha256)
    await store.remove(b.sha256)
    addEntry([a, b])
    const stray = new File([new Uint8Array([42, 42])], 'stray.jpg', {
      type: 'image/jpeg',
    })

    const out = await radioLog.storePacketMedia(
      [fileA(), stray],
      radioLog.getCurrentRadioLog().logEntries
    )

    expect(out).toEqual({ added: 1, unmatched: 1, remote: 1 })
    expect(await store.has(a.sha256)).toBe(true)
    expect(await store.has(b.sha256)).toBe(false)
  })

  it('does not store a file that only a removed reference names', async () => {
    const a = await store.add(fileA(), 'K7ABC')
    await store.remove(a.sha256)
    addEntry([{ ...a, removed: { at: '2026-10-16T12:00:00Z', by: 'K7ABC' } }])

    const out = await radioLog.storePacketMedia([fileA()])

    expect(out.added).toBe(0)
    expect(out.unmatched).toBe(1)
    expect(await store.has(a.sha256)).toBe(false)
  })

  it('a file that is already here is not counted twice', async () => {
    const a = await store.add(fileA(), 'K7ABC')
    addEntry([a])

    expect((await radioLog.storePacketMedia([fileA()])).added).toBe(0)
  })
})
