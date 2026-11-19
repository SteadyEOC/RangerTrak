/**
 * E-325: reads the user's downloaded call sign file and hands the kept rows to a sink in batches. This is the
 * heavy half (fflate streaming unzip), so it is only ever loaded by a dynamic import() from the Settings import
 * action. Entry and the Radio Log use the lookup alone and never pull this in (check:eager-bundle).
 *
 * Memory: the file is read as a stream, chunk by chunk, and the unzip output is decoded and split into lines as
 * it arrives; the whole EN.dat is never a string. The FCC file is read twice (the user's `File` is re-opened,
 * never held): pass 1 collects the active licence ids, pass 2 keeps the matching people.
 */
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import {
  ChunkDecoder, LineSplitter, FCC_REGION_REQUIRED, parseFccActiveUsi, parseFccEntityRow, parseIsedHeader,
  parseIsedRow, parseRegionFilter, roleForEntry,
  type DirectoryRow, type DirectorySource, type IsedColumns,
} from './callsign-directory'

export type ImportProgress = { phase: string; rowsRead: number; rowsKept: number }

/** Where kept rows go. The service implements it over IndexedDB (a staging store, swapped in at the end). */
export type DirectorySink = { put(rows: DirectoryRow[]): Promise<void> }

export type ImportResult = { source: DirectorySource; count: number; fileDate?: string; region: string }

const BATCH = 2000

/** The reason an import stopped, in plain words for the Settings card. */
export class DirectoryImportError extends Error { }

function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04
}

/**
 * Streams every wanted entry of the file (a zip, or one plain text file) as lines. `afterChunk` runs between
 * input chunks, where the caller can await a database write, so memory stays at about one chunk's worth.
 */
export async function streamLines(
  file: File,
  wanted: (entryName: string) => boolean,
  onLine: (entryName: string, line: string) => void,
  afterChunk: () => Promise<void>,
): Promise<void> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const reader = file.stream().getReader()
  try {
    if (!isZip(head)) {
      if (!wanted(file.name)) return
      const dec = new ChunkDecoder()
      const split = new LineSplitter()
      for (; ;) {
        const { done, value } = await reader.read()
        const text = dec.decode(done ? new Uint8Array(0) : value, done)
        for (const l of split.push(text)) onLine(file.name, l)
        if (done) break
        await afterChunk()
      }
      for (const l of split.end()) onLine(file.name, l)
      return
    }
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    unzip.register(UnzipPassThrough)
    unzip.onfile = entry => {
      if (!wanted(entry.name)) return
      const dec = new ChunkDecoder()
      const split = new LineSplitter()
      entry.ondata = (err, data, final) => {
        if (err) throw err
        for (const l of split.push(dec.decode(data, final))) onLine(entry.name, l)
        if (final) for (const l of split.end()) onLine(entry.name, l)
      }
      entry.start()
    }
    for (; ;) {
      const { done, value } = await reader.read()
      if (done) { unzip.push(new Uint8Array(0), true); break }
      unzip.push(value, false)
      await afterChunk()
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function importDirectoryFile(
  file: File, regionText: string, sink: DirectorySink, onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const filter = parseRegionFilter(regionText)
  const fileDate = file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : undefined
  let rowsRead = 0
  let rowsKept = 0
  let pending: DirectoryRow[] = []
  const flush = async (force = false) => {
    if (pending.length && (force || pending.length >= BATCH)) {
      const batch = pending
      pending = []
      await sink.put(batch)
    }
  }

  // Which kind of file is it? An FCC zip holds HD.dat and EN.dat; anything else with text is the ISED list.
  const names = new Set<string>()
  if (isZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) {
    await streamLines(file, n => { names.add(n); return false }, () => undefined, async () => undefined)
  } else {
    names.add(file.name)
  }
  const roles = new Set([...names].map(roleForEntry))
  const isFcc = roles.has('fcc-status') && roles.has('fcc-people')

  if (isFcc) {
    if (filter.all) throw new DirectoryImportError(FCC_REGION_REQUIRED)
    const active = new Set<string>()
    onProgress({ phase: 'Reading licence status', rowsRead, rowsKept })
    await streamLines(file, n => roleForEntry(n) === 'fcc-status', (_n, line) => {
      rowsRead++
      const usi = parseFccActiveUsi(line)
      if (usi) active.add(usi)
    }, async () => onProgress({ phase: 'Reading licence status', rowsRead, rowsKept }))
    rowsRead = 0
    await streamLines(file, n => roleForEntry(n) === 'fcc-people', (_n, line) => {
      rowsRead++
      const row = parseFccEntityRow(line, active, filter)
      if (row) { pending.push(row); rowsKept++ }
    }, async () => { await flush(); onProgress({ phase: 'Reading names', rowsRead, rowsKept }) })
    await flush(true)
    return { source: 'fcc', count: rowsKept, fileDate, region: filter.text }
  }

  if (roles.has('fcc-status') || roles.has('fcc-people')) {
    throw new DirectoryImportError('This looks like part of the United States file. Choose the whole l_amat.zip file instead.')
  }
  if (!roles.has('ised')) {
    throw new DirectoryImportError('This is not a call sign list I know. Choose amateur_delim.zip from ISED, or l_amat.zip from the FCC.')
  }

  const columns = new Map<string, IsedColumns | null>()
  let headerSeen = false
  await streamLines(file, n => roleForEntry(n) === 'ised', (name, line) => {
    if (!line.trim()) return
    if (!columns.has(name)) {
      const cols = parseIsedHeader(line)
      columns.set(name, cols)
      if (cols) headerSeen = true
      return
    }
    const cols = columns.get(name)
    if (!cols) return
    rowsRead++
    const row = parseIsedRow(line, cols, filter)
    if (row) { pending.push(row); rowsKept++ }
  }, async () => { await flush(); onProgress({ phase: 'Reading names', rowsRead, rowsKept }) })
  await flush(true)
  if (!headerSeen) {
    throw new DirectoryImportError('I could not find the call sign column in this file. Is it the ISED amateur list?')
  }
  return { source: 'ised', count: rowsKept, fileDate, region: filter.text }
}
