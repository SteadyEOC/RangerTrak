import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import type { AttachmentRef } from '../../domain/attachments'
import { buildAttachmentsZipBytes } from '../export/attachments-zip'
import { recordStore } from '../storage/record-store'
import { AttachmentStoreService, sha256Hex } from './attachment-store.service'
import { BackupService } from './backup.service'
import { RadioLogService } from './radio-log.service'

/**
 * E-194 / ADR D-60 item 6: the backup JSON stays references only, and the bytes travel in a
 * companion zip under the same passphrase. Restore re-hashes everything.
 */
describe('BackupService attachments companion (E-194)', () => {
  let backup: BackupService
  let store: AttachmentStoreService
  let radioLog: RadioLogService
  let downloads: {
    name: string
    url: string
  }[]

  const wavBytes = new Uint8Array([82, 73, 70, 70, 9, 8, 7, 6, 5, 4, 3, 2])
  const wav = () =>
    new File([wavBytes], 'memo.wav', { type: 'audio/wav', lastModified: 1700000000000 })

  /** Puts one entry on the device that carries the stored attachment's reference. */
  async function addEntryWithAttachment(): Promise<AttachmentRef> {
    const ref = await store.add(wav(), 'K7ABC')
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'RT1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes: 'with a memo',
        attachments: [ref],
      })
    )
    return ref
  }

  const fileFromDownload = async (d: { name: string; url: string }) =>
    new File([await (await fetch(d.url)).blob()], d.name)

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    backup = TestBed.inject(BackupService)
    store = TestBed.inject(AttachmentStoreService)
    radioLog = TestBed.inject(RadioLogService)
    await store.whenReady()
    await radioLog.deleteAllRadioLogEntries()

    downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloads.push({ name: this.download, url: this.href })
    })
  })

  afterEach(async () => {
    await radioLog.deleteAllRadioLogEntries()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('the backup JSON carries references only, never bytes', async () => {
    const ref = await addEntryWithAttachment()

    const payload = await backup.buildExportPayload()

    const text = JSON.stringify(payload)
    expect(payload.radioLog.logEntries[0].attachments?.[0].sha256).toBe(ref.sha256)
    expect(text).not.toContain('UklGR') // base64 of "RIFF", the start of the file's bytes
    expect('attachments' in payload).toBe(false)
  })

  it('writes no companion file when no attachment has bytes here', async () => {
    await backup.exportMission()
    expect(
      downloads.map((d) => d.name).filter((n) => n.endsWith('-attachments.zip'))
    ).toEqual([])
  })

  it('writes a companion zip beside the JSON, and the zip alone restores the bytes after they are gone', async () => {
    const ref = await addEntryWithAttachment()

    await backup.exportMission()

    expect(downloads.length).toBe(2)
    expect(downloads[0].name).toMatch(/\.json$/)
    expect(downloads[1].name).toMatch(/-attachments\.zip$/)
    const zip = await fileFromDownload(downloads[1])
    expect(await backup.classifyRestoreFile(zip)).toBe('attachments')
    // (The JSON's own object URL is revoked as soon as it is clicked, so classify an equal copy.)
    const json = new File(
      [JSON.stringify(await backup.buildExportPayload())],
      downloads[0].name
    )
    expect(await backup.classifyRestoreFile(json)).toBe('backup')

    await store.remove(ref.sha256)
    expect(await store.has(ref.sha256)).toBe(false)
    expect((await backup.attachmentsStatus()).elsewhere).toBe(1)

    const result = await backup.restoreAttachmentsFile(zip)

    expect(result).toEqual(
      expect.objectContaining({ restored: 1, elsewhere: 0, mismatched: [] })
    )
    expect(backup.describeAttachmentsRestore(result)).toBe('1 attachment restored.')
    expect(
      new Uint8Array(await (await store.getOriginal(ref.sha256)).arrayBuffer())
    ).toEqual(wavBytes)
  })

  it('a tampered file is listed as a mismatch and never stored', async () => {
    const ref = await addEntryWithAttachment()
    await store.remove(ref.sha256)
    const tampered = buildAttachmentsZipBytes(
      [
        {
          sha256: ref.sha256,
          name: 'memo.wav',
          type: 'audio/wav',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      new Date().toISOString()
    )

    const result = await backup.restoreAttachmentsFile(
      new File([tampered as BlobPart], 'x-attachments.zip')
    )

    expect(result.restored).toBe(0)
    expect(result.mismatched).toEqual(['memo.wav'])
    expect(await store.has(ref.sha256)).toBe(false)
    expect(backup.describeAttachmentsRestore(result)).toContain(
      'did not match their fingerprint'
    )
  })

  it('a file no live reference names is ignored, not stored as an orphan', async () => {
    const stray = new Uint8Array([4, 4, 4])
    const sha = await sha256Hex(stray.buffer)
    const zip = buildAttachmentsZipBytes(
      [{ sha256: sha, name: 'stray.wav', type: 'audio/wav', bytes: stray }],
      new Date().toISOString()
    )

    const result = await backup.restoreAttachmentsFile(
      new File([zip as BlobPart], 'x-attachments.zip')
    )

    expect(result.unreferenced).toBe(1)
    expect(await store.has(sha)).toBe(false)
  })

  it('with a passphrase the companion is encrypted (.rtenc.zip), recognised by its hint, and opens with the same passphrase', async () => {
    const ref = await addEntryWithAttachment()

    await backup.exportMission('one passphrase')

    expect(downloads[1].name).toMatch(/-attachments\.rtenc\.zip$/)
    const encrypted = await fileFromDownload(downloads[1])
    expect(await backup.classifyRestoreFile(encrypted)).toBe('attachments')
    expect(await encrypted.text()).not.toContain('RIFF')

    await store.remove(ref.sha256)
    await expect(
      backup.restoreAttachmentsFile(encrypted, () => 'wrong')
    ).rejects.toThrow()
    const result = await backup.restoreAttachmentsFile(encrypted, () => 'one passphrase')

    expect(result.restored).toBe(1)
    expect(await store.has(ref.sha256)).toBe(true)
  })

  it('LARGE: a 64 MB attachment goes through an encrypted companion and back, byte for byte', async () => {
    const big = new Uint8Array(64 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 0xff
    const ref = await store.add(
      new File([big], 'run.mp4', { type: 'video/mp4' }),
      'K7ABC'
    )
    radioLog.addRadioLogEntry(
      JSON.stringify({
        callsign: 'RT1',
        location: { lat: 47.41, lng: -122.41, derivedFromAddress: false },
        date: new Date(),
        status: 'Normal',
        notes: 'big',
        attachments: [ref],
      })
    )

    await backup.exportMission('big passphrase')
    const companion = await fileFromDownload(downloads[1])
    await store.remove(ref.sha256)
    const result = await backup.restoreAttachmentsFile(companion, () => 'big passphrase')

    expect(result.restored).toBe(1)
    const back = await store.getOriginal(ref.sha256)
    expect(back.size).toBe(big.length)
    expect(await sha256Hex(await back.arrayBuffer())).toBe(ref.sha256)
  }, 180000)

  it('restoring a backup whose references have no bytes here reports them as on another device', async () => {
    const ref = await addEntryWithAttachment()
    await store.remove(ref.sha256)

    const status = await backup.attachmentsStatus()

    expect(status.elsewhere).toBe(1)
    expect(backup.describeAttachmentsRestore(status)).toBe(
      '0 attachments restored, 1 still on another device.'
    )
  })
})
