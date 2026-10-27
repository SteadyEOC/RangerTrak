/**
 * A photo's own EXIF (location, capture time, camera and the rest), carried from the original into
 * its smaller copy (John 2026-10-27: the metadata is valuable and is dropped only where it
 * technically can't be kept). A canvas holds pixels only, so the block is read from the original's
 * bytes and written into the new JPEG as an APP1 segment.
 *
 * Two values are corrected, because they describe the old pixels: Orientation becomes 1 (the
 * rotation was applied while decoding) and the pixel size becomes the copy's. The embedded preview
 * (IFD1) is dropped: it is the old size, and often the bulk of the block.
 *
 * Pure byte work, no browser APIs. Anything unexpected gives null, and the copy goes without.
 */

/** The TIFF block (starting `II*\0` or `MM\0*`) of a JPEG, PNG, WebP, HEIC or AVIF file, or null. */
export function readExif(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return fromJpeg(bytes)
    if (ascii(bytes, 1, 3) === 'PNG') return tiffOrNull(fromPng(bytes))
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return tiffOrNull(stripExifHeader(fromWebp(bytes)))
    if (ascii(bytes, 4, 4) === 'ftyp') return tiffOrNull(fromIsobmff(bytes))
  } catch { /* a damaged or unusual file: no EXIF */ }
  return null
}

/**
 * `jpeg` with `tiff` inserted as its EXIF, the orientation, pixel size and preview corrected for a
 * `width` x `height` image. Null when the block can't be read safely or is too big for one segment.
 */
export function writeExif(jpeg: Uint8Array, tiff: Uint8Array, width: number, height: number): Uint8Array | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null
  const fixed = fixTiff(tiff, width, height)
  if (!fixed) return null
  const length = 2 + 6 + fixed.length
  if (length > 0xffff) return null
  // After the JFIF segment the encoder writes, if there is one, as cameras lay it out.
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5])
  const out = new Uint8Array(jpeg.length + 2 + length)
  out.set(jpeg.subarray(0, at), 0)
  out.set([0xff, 0xe1, length >> 8, length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], at)
  out.set(fixed, at + 10)
  out.set(jpeg.subarray(at), at + 10 + fixed.length)
  return out
}

const ORIENTATION = 0x0112
const IMAGE_WIDTH = 0x0100
const IMAGE_HEIGHT = 0x0101
const EXIF_IFD = 0x8769
const PIXEL_X = 0xa002
const PIXEL_Y = 0xa003
const THUMB_OFFSET = 0x0201
const THUMB_LENGTH = 0x0202

function fixTiff(source: Uint8Array, width: number, height: number): Uint8Array | null {
  if (!tiffOrNull(source)) return null
  let tiff: Uint8Array = source.slice()
  const view = new DataView(tiff.buffer)
  const le = tiff[0] === 0x49
  const u16 = (at: number) => view.getUint16(at, le)
  const u32 = (at: number) => view.getUint32(at, le)
  const entries = (ifd: number): number[] => {
    if (ifd < 8 || ifd + 2 > tiff.length) throw new RangeError('IFD')
    const n = u16(ifd)
    if (ifd + 2 + n * 12 + 4 > tiff.length) throw new RangeError('IFD')
    return Array.from({ length: n }, (_, i) => ifd + 2 + i * 12)
  }
  const setNumber = (entry: number, value: number) => {
    const type = u16(entry + 2)
    if (type === 3) view.setUint16(entry + 8, value, le)
    else if (type === 4) view.setUint32(entry + 8, value, le)
  }
  try {
    const ifd0 = u32(4)
    const list0 = entries(ifd0)
    let exifIfd = 0
    for (const e of list0) {
      const tag = u16(e)
      if (tag === ORIENTATION) view.setUint16(e + 8, 1, le)
      else if (tag === IMAGE_WIDTH) setNumber(e, width)
      else if (tag === IMAGE_HEIGHT) setNumber(e, height)
      else if (tag === EXIF_IFD) exifIfd = u32(e + 8)
    }
    if (exifIfd) {
      for (const e of entries(exifIfd)) {
        const tag = u16(e)
        if (tag === PIXEL_X) setNumber(e, width)
        else if (tag === PIXEL_Y) setNumber(e, height)
      }
    }
    const next = ifd0 + 2 + list0.length * 12
    const ifd1 = u32(next)
    view.setUint32(next, 0, le)
    if (ifd1) {
      // The preview's bytes usually end the block; then they can be cut off as well as unlinked.
      let offset = 0
      let length = 0
      for (const e of entries(ifd1)) {
        if (u16(e) === THUMB_OFFSET) offset = u32(e + 8)
        else if (u16(e) === THUMB_LENGTH) length = u32(e + 8)
      }
      if (offset && offset + length === tiff.length) tiff = tiff.subarray(0, offset)
    }
    return tiff
  } catch {
    return null
  }
}

function fromJpeg(bytes: Uint8Array): Uint8Array | null {
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    if (marker === 0xe1 && ascii(bytes, at + 4, 6) === 'Exif\0\0') return tiffOrNull(bytes.subarray(at + 10, at + 2 + length))
    at += 2 + length
  }
  return null
}

function fromPng(bytes: Uint8Array): Uint8Array | null {
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = be32(bytes, at)
    const type = ascii(bytes, at + 4, 4)
    if (type === 'eXIf') return bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IDAT' || type === 'IEND') break
    at += 12 + length
  }
  return null
}

function fromWebp(bytes: Uint8Array): Uint8Array | null {
  let at = 12
  while (at + 8 <= bytes.length) {
    const length = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)
    if (ascii(bytes, at, 4) === 'EXIF') return bytes.subarray(at + 8, at + 8 + length)
    at += 8 + length + (length & 1)
  }
  return null
}

/** HEIC and AVIF: the item of type `Exif` named in `meta/iinf`, found through `meta/iloc`. */
function fromIsobmff(bytes: Uint8Array): Uint8Array | null {
  const meta = boxes(bytes, 0, bytes.length).find(b => b.type === 'meta')
  if (!meta) return null
  const inner = boxes(bytes, meta.start + 4, meta.end)
  const iinf = inner.find(b => b.type === 'iinf')
  const iloc = inner.find(b => b.type === 'iloc')
  if (!iinf || !iloc) return null

  let exifId = -1
  const iinfVersion = bytes[iinf.start]
  for (const infe of boxes(bytes, iinf.start + 4 + (iinfVersion === 0 ? 2 : 4), iinf.end)) {
    if (infe.type !== 'infe') continue
    const version = bytes[infe.start]
    if (version < 2) continue
    const id = version === 2 ? be16(bytes, infe.start + 4) : be32(bytes, infe.start + 4)
    const typeAt = infe.start + 4 + (version === 2 ? 2 : 4) + 2
    if (ascii(bytes, typeAt, 4) === 'Exif') { exifId = id; break }
  }
  if (exifId < 0) return null

  const version = bytes[iloc.start]
  let at = iloc.start + 4
  const offsetSize = bytes[at] >> 4
  const lengthSize = bytes[at] & 15
  const baseSize = bytes[at + 1] >> 4
  const indexSize = version === 1 || version === 2 ? bytes[at + 1] & 15 : 0
  at += 2
  const read = (size: number) => {
    const v = size === 0 ? 0 : size === 2 ? be16(bytes, at) : size === 4 ? be32(bytes, at) : size === 8 ? be32(bytes, at + 4) : NaN
    if (Number.isNaN(v) || (size === 8 && be32(bytes, at) !== 0)) throw new RangeError('iloc')
    at += size
    return v
  }
  const count = read(version < 2 ? 2 : 4)
  for (let i = 0; i < count; i++) {
    const id = read(version < 2 ? 2 : 4)
    const method = version === 1 || version === 2 ? read(2) & 15 : 0
    read(2) // data reference index
    const base = read(baseSize)
    const extents = read(2)
    let found: Uint8Array | null = null
    for (let x = 0; x < extents; x++) {
      read(indexSize)
      const offset = read(offsetSize)
      const length = read(lengthSize)
      if (id === exifId && x === 0 && method === 0) found = bytes.subarray(base + offset, base + offset + length)
    }
    if (found) {
      // The item starts with the offset of the TIFF header within the rest of it.
      const skip = be32(found, 0)
      return found.subarray(4 + skip)
    }
  }
  return null
}

type Box = { type: string, start: number, end: number }

/** The boxes between `from` and `to`; `start` is where each one's content begins. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = be32(bytes, at)
    let header = 8
    if (size === 1) { size = be32(bytes, at + 12) + be32(bytes, at + 8) * 2 ** 32; header = 16 }
    else if (size === 0) size = to - at
    if (size < header || at + size > to) break
    out.push({ type: ascii(bytes, at + 4, 4), start: at + header, end: at + size })
    at += size
  }
  return out
}

function stripExifHeader(block: Uint8Array | null): Uint8Array | null {
  return block && ascii(block, 0, 6) === 'Exif\0\0' ? block.subarray(6) : block
}

function tiffOrNull(block: Uint8Array | null): Uint8Array | null {
  if (!block || block.length < 8) return null
  const sig = ascii(block, 0, 2)
  if (sig === 'II' && block[2] === 42 && block[3] === 0) return block
  if (sig === 'MM' && block[2] === 0 && block[3] === 42) return block
  return null
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

function be16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

function be32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
}
