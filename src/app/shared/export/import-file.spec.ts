import { buildCorpus } from '../../../testing/import-corpus/corpus'
import { diagnoseBytes, diagnoseFile } from './import-file'

/** E-198: the file-reading half of the diagnosis, run over the corpus the way the import screens do. */
describe('import-file (E-198)', () => {
  const corpus = buildCorpus()
  const get = (name: string) => corpus.find((f) => f.name === name)!

  it('diagnoseFile reads a picked file the way the Report Packet import does', async () => {
    const good = get('report-packet.txt')
    expect(
      (await diagnoseFile(new Blob([good.bytes as BlobPart]), 'report-packet')).problem
    ).toBe('none')
    const cut = get('report-packet-cut.txt')
    expect(
      (await diagnoseFile(new Blob([cut.bytes as BlobPart]), 'report-packet')).problem
    ).toBe('cut-off')
    const zip = get('setup-file.zip')
    expect(
      (await diagnoseFile(new Blob([zip.bytes as BlobPart]), 'report-packet')).message
    ).toContain('Mission > Setup files')
  })

  it('diagnoseBytes reads a Setup file import: a real Setup file and a hand-over pass, everything else says why not', () => {
    expect(diagnoseBytes(get('setup-file.zip').bytes, 'setup-file').problem).toBe('none')
    expect(diagnoseBytes(get('handover.zip').bytes, 'setup-file').problem).toBe('none')
    expect(
      diagnoseBytes(get('handover-encrypted.rtenc.zip').bytes, 'setup-file').problem
    ).toBe('locked')
    expect(diagnoseBytes(get('backup-good.json').bytes, 'setup-file').message).toContain(
      'Mission > Data safety > Restore'
    )
    expect(diagnoseBytes(get('roster.xlsx').bytes, 'setup-file').message).toContain(
      'Rangers > Import'
    )
    expect(diagnoseBytes(get('random.bin').bytes, 'setup-file').message).toBe(
      "This isn't a RangerTrak file."
    )
  })
})
