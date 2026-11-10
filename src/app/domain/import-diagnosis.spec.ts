import {
  buildCorpus,
  sampleBackup,
  samplePacket,
} from '../../testing/import-corpus/corpus'
import type { ExpectedImport } from './import-diagnosis'
import { diagnoseImportFile, stripBom, stripBomBytes } from './import-diagnosis'

const EXPECTED: ExpectedImport[] = ['backup', 'report-packet', 'setup-file']

function diagnose(name: string, expected: ExpectedImport) {
  const file = buildCorpus().find((f) => f.name === name)!
  return diagnoseImportFile(file.bytes.slice(0, 8192), file.text, expected)
}

describe('diagnoseImportFile (E-198)', () => {
  describe('every corpus file through every import', () => {
    for (const file of buildCorpus()) {
      for (const expected of EXPECTED) {
        const ok = file.expectedOk.includes(expected)
        it(`${file.name} as ${expected}: ${ok ? 'looks right' : 'says what is wrong'}`, () => {
          const d = diagnoseImportFile(file.bytes.slice(0, 8192), file.text, expected)
          if (ok) {
            expect(d.problem, d.technical).toBe('none')
            expect(d.message).toBe('')
          } else {
            expect(d.problem, d.technical).not.toBe('none')
            expect(d.message.length).toBeGreaterThan(20)
            expect(d.technical.length).toBeGreaterThan(0)
          }
        })
      }
    }

    it('never puts a field name in quotes or a raw parser error in a message', () => {
      for (const file of buildCorpus()) {
        for (const expected of EXPECTED) {
          const d = diagnoseImportFile(file.bytes.slice(0, 8192), file.text, expected)
          expect(d.message, `${file.name} as ${expected}`).not.toMatch(
            /"[A-Za-z]+"|JSON|position \d|undefined|Unexpected/
          )
        }
      }
    })
  })

  describe('the specific answers', () => {
    it('names the right place for a Setup file given to Restore', () => {
      const d = diagnose('setup-file.zip', 'backup')
      expect(d.problem).toBe('wrong-kind')
      expect(d.detected).toBe('setup-file')
      expect(d.message).toContain('Mission > Setup files')
      expect(d.goTo?.path).toBe('/mission#setup-file')
    })

    it('recognises a hand-over zip the same way', () => {
      expect(diagnose('handover.zip', 'report-packet').message).toContain(
        'Radio Log > Hand over to another scribe'
      )
    })

    it('tells a locked hand-over from a locked backup', () => {
      expect(diagnose('handover-encrypted.rtenc.zip', 'setup-file').problem).toBe(
        'locked'
      )
      expect(diagnose('handover-encrypted.rtenc.zip', 'backup').problem).toBe(
        'wrong-kind'
      )
      expect(diagnose('backup-encrypted.rtenc.json', 'backup').detected).toBe(
        'encrypted-backup'
      )
      expect(diagnose('backup-encrypted.rtenc.json', 'report-packet').message).toContain(
        'Report Packet'
      )
    })

    it('says a backup is a backup when a Report Packet was expected, and the reverse', () => {
      expect(diagnose('backup-good.json', 'report-packet').message).toBe(
        "This is a mission backup. Restoring it replaces everything; to add someone's entries, ask them for a Report Packet."
      )
      const d = diagnose('report-packet.txt', 'backup')
      expect(d.problem).toBe('wrong-kind')
      expect(d.message).toContain('Report Packet')
      expect(d.goTo?.label).toContain('Load Report Packet')
    })

    it('sends a spreadsheet to Rangers > Import, CSV and XLSX alike', () => {
      for (const name of ['roster.csv', 'roster.xlsx']) {
        const d = diagnose(name, 'backup')
        expect(d.detected, name).toBe('spreadsheet')
        expect(d.message).toBe(
          'This looks like a spreadsheet. Roster spreadsheets go in Rangers > Import.'
        )
      }
    })

    it('says a truncated file is cut off, at 10, 50 and 95 percent, and where it stops', () => {
      for (const name of [
        'backup-truncated-10.json',
        'backup-truncated-50.json',
        'backup-truncated-95.json',
      ]) {
        const d = diagnose(name, 'backup')
        expect(d.problem, name).toBe('cut-off')
        expect(d.message, name).toContain('This file is cut off')
        expect(d.message, name).toContain('Ask for it again')
      }
      expect(diagnose('backup-truncated-50.json', 'backup').message).toMatch(
        /partway through the (radio log|roster|places|mission settings)/
      )
    })

    it('says a cut-off Report Packet is cut off', () => {
      expect(diagnose('report-packet-cut.txt', 'report-packet').problem).toBe('cut-off')
    })

    it('does not mistake a hand-typed syntax slip for a cut-off file', () => {
      const text = JSON.stringify(sampleBackup(), null, 2).replace(
        '"rangers": [',
        '"rangers": [,,'
      )
      const d = diagnoseImportFile(new TextEncoder().encode(text), text, 'backup')
      expect(d.problem).toBe('damaged')
    })

    it('asks for an update when the file is from a newer RangerTrak', () => {
      for (const [name, expected] of [
        ['backup-newer-schema.json', 'backup'],
        ['report-packet-newer-schema.txt', 'report-packet'],
      ] as const) {
        const d = diagnose(name, expected)
        expect(d.problem).toBe('newer-version')
        expect(d.message).toBe('Made by a newer RangerTrak. Update this device first.')
      }
    })

    it('uses the limits the caller passes', () => {
      const text = JSON.stringify(samplePacket())
      const d = diagnoseImportFile(
        new TextEncoder().encode(text),
        text,
        'report-packet',
        { backup: 1, reportPacket: 0 }
      )
      expect(d.problem).toBe('newer-version')
    })

    it('calls a backup with the roster as an object damaged or hand-edited, and names the problem plainly', () => {
      const d = diagnose('backup-hand-edited.json', 'backup')
      expect(d.problem).toBe('damaged')
      expect(d.message).toContain('damaged or was edited by hand')
      expect(d.message).toContain('the roster is not a list')
      expect(d.message).toContain('Ask for a fresh copy')
    })

    it('says random bytes are not a RangerTrak file', () => {
      const d = diagnose('random.bin', 'backup')
      expect(d.problem).toBe('not-rangertrak')
      expect(d.message).toBe("This isn't a RangerTrak file.")
    })

    it('says plain unrelated text, an empty file and unrelated JSON are not RangerTrak files either', () => {
      for (const text of [
        'Dear team, the drill is on Saturday.',
        '   ',
        '{"hello":"world"}',
        '42',
        '[1,2,3]',
      ]) {
        const d = diagnoseImportFile(new TextEncoder().encode(text), text, 'backup')
        expect(d.problem, text).toBe('not-rangertrak')
      }
    })

    it('handles a binary file that was decoded to text', () => {
      const bytes = new Uint8Array(200).map((_, i) => (i * 37) % 256)
      bytes[0] = 7
      const d = diagnoseImportFile(
        bytes,
        new TextDecoder().decode(bytes),
        'report-packet'
      )
      expect(d.problem).toBe('not-rangertrak')
    })
  })

  describe('byte order mark', () => {
    it('strips a BOM from text and from bytes', () => {
      expect(stripBom('﻿hello')).toBe('hello')
      expect(stripBom('hello')).toBe('hello')
      expect([...stripBomBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b]))]).toEqual([0x7b])
    })

    it('reads a BOM-prefixed backup as the backup it is', () => {
      const d = diagnose('backup-with-bom.json', 'backup')
      expect(d.problem).toBe('none')
      expect(d.detected).toBe('backup')
    })
  })
})
