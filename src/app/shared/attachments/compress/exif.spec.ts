import { readExif, writeExif } from './exif'
import { compressImage } from './image'

/**
 * John 2026-10-27: a smaller copy keeps the photo's own metadata wherever it technically can.
 * The EXIF here is built by hand (a made-up latitude reference, nothing real).
 */
describe('smaller copies keep EXIF', () => {

  /**
   * A little-endian TIFF block: IFD0 (Orientation 6, Exif and GPS pointers), an Exif IFD (4000 x 3000),
   * a GPS IFD (latitude ref "N") and an IFD1 whose 10-byte preview ends the block.
   */
  function tiff(): Uint8Array {
    const b = new Uint8Array(138)
    const v = new DataView(b.buffer)
    b.set([0x49, 0x49, 42, 0]); v.setUint32(4, 8, true)
    const entry = (at: number, tag: number, type: number, value: number) => {
      v.setUint16(at, tag, true); v.setUint16(at + 2, type, true); v.setUint32(at + 4, 1, true)
      if (type === 3) v.setUint16(at + 8, value, true); else v.setUint32(at + 8, value, true)
    }
    v.setUint16(8, 3, true)
    entry(10, 0x0112, 3, 6)
    entry(22, 0x8769, 4, 50)
    entry(34, 0x8825, 4, 80)
    v.setUint32(46, 98, true)
    v.setUint16(50, 2, true)
    entry(52, 0xa002, 4, 4000)
    entry(64, 0xa003, 4, 3000)
    v.setUint16(80, 1, true)
    v.setUint16(82, 0x0001, true); v.setUint16(84, 2, true); v.setUint32(86, 2, true); b.set([0x4e, 0], 90)
    v.setUint16(98, 2, true)
    entry(100, 0x0201, 4, 128)
    entry(112, 0x0202, 4, 10)
    b.fill(0xaa, 128)
    return b
  }

  /** The value of `tag` in the IFD at `ifd`, read as its stored type. */
  function tag(t: Uint8Array, ifd: number, id: number): number | undefined {
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength)
    for (let i = 0; i < v.getUint16(ifd, true); i++) {
      const e = ifd + 2 + i * 12
      if (v.getUint16(e, true) !== id) continue
      return v.getUint16(e + 2, true) === 3 ? v.getUint16(e + 8, true) : v.getUint32(e + 8, true)
    }
    return undefined
  }

  async function canvasJpeg(width: number, height: number): Promise<Uint8Array> {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.fillRect(0, 0, width, height)
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.9))
    return new Uint8Array(await blob.arrayBuffer())
  }

  function withApp1(jpeg: Uint8Array, block: Uint8Array): Uint8Array {
    const length = 8 + block.length
    const out = new Uint8Array(jpeg.length + 2 + length)
    out.set(jpeg.subarray(0, 2))
    out.set([0xff, 0xe1, length >> 8, length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 2)
    out.set(block, 12)
    out.set(jpeg.subarray(2), 12 + block.length)
    return out
  }

  it('reads EXIF from a JPEG, a PNG eXIf chunk and a WebP EXIF chunk', async () => {
    const t = tiff()
    expect(readExif(withApp1(await canvasJpeg(8, 8), t))).toEqual(t)

    const png = new Uint8Array(8 + 12 + t.length)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(8, t.length)
    png.set([0x65, 0x58, 0x49, 0x66], 12)
    png.set(t, 16)
    expect(readExif(png)).toEqual(t)

    const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...t])
    const webp = new Uint8Array(12 + 8 + exif.length)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x45, 0x58, 0x49, 0x46])
    new DataView(webp.buffer).setUint32(16, exif.length, true)
    webp.set(exif, 20)
    expect(readExif(webp)).toEqual(t)
  })

  it('reads the Exif item of a HEIC through meta/iinf and meta/iloc', () => {
    const t = tiff()
    const box = (type: string, body: number[]) => {
      const size = 8 + body.length
      return [size >>> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...[...type].map(c => c.charCodeAt(0)), ...body]
    }
    const infe = box('infe', [2, 0, 0, 0, 0, 7, 0, 0, ...[...'Exif'].map(c => c.charCodeAt(0)), 0])
    const iinf = box('iinf', [0, 0, 0, 0, 0, 1, ...infe])
    const ftyp = box('ftyp', [...[...'heic'].map(c => c.charCodeAt(0)), 0, 0, 0, 0])
    // iloc v0, 4-byte offset and length, no base offset: item 7, one extent. The offset is filled in below.
    const iloc = box('iloc', [0, 0, 0, 0, 0x44, 0x00, 0, 1, 0, 7, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    const meta = box('meta', [0, 0, 0, 0, ...iinf, ...iloc])
    const payload = [0, 0, 0, 0, ...t]
    const bytes = new Uint8Array([...ftyp, ...meta, ...payload])
    const v = new DataView(bytes.buffer)
    const ilocAt = ftyp.length + 12 + iinf.length
    v.setUint32(ilocAt + 8 + 14, ftyp.length + meta.length)
    v.setUint32(ilocAt + 8 + 18, payload.length)
    expect(readExif(bytes)).toEqual(t)
  })

  it('writes it into a JPEG with Orientation 1, the new pixel size and no preview', async () => {
    const out = writeExif(await canvasJpeg(64, 48), tiff(), 64, 48)!
    const back = readExif(out)!
    expect(back).not.toBeNull()
    expect(tag(back, 8, 0x0112)).toBe(1)
    expect(tag(back, 50, 0xa002)).toBe(64)
    expect(tag(back, 50, 0xa003)).toBe(48)
    expect(String.fromCharCode(back[90])).toBe('N')
    expect(new DataView(back.buffer, back.byteOffset).getUint32(46, true)).toBe(0)
    expect(back.length).toBe(128)
    const bitmap = await createImageBitmap(new Blob([out as BlobPart], { type: 'image/jpeg' }))
    expect([bitmap.width, bitmap.height]).toEqual([64, 48])
    bitmap.close()
  })

  it('gives null rather than a damaged block', () => {
    const bad = tiff()
    new DataView(bad.buffer).setUint32(4, 5000, true)
    expect(readExif(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(writeExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), bad, 1, 1)).toBeNull()
  })

  it('a smaller copy of a photo carries the original\'s location', async () => {
    const original = withApp1(await canvasJpeg(3000, 2000), tiff())
    const result = await compressImage(new Blob([original as BlobPart], { type: 'image/jpeg' }))
    const back = readExif(new Uint8Array(await result!.blob.arrayBuffer()))!
    expect(String.fromCharCode(back[90])).toBe('N')
    expect(tag(back, 8, 0x0112)).toBe(1)
    // Orientation 6 turns the 3000 x 2000 picture on its side, and the copy is at most 2048 px.
    const bitmap = await createImageBitmap(result!.blob)
    expect(tag(back, 50, 0xa002)).toBe(bitmap.width)
    expect(tag(back, 50, 0xa003)).toBe(bitmap.height)
    bitmap.close()
  })
})
