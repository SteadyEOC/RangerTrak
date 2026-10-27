import { BlobSource, BufferTarget, CanvasSource, Input, MP4, MovOutputFormat, Output, Quality } from 'mediabunny'

import { LOCATION_KEY } from './media-tags'

import { canCompress, canCompressFile } from './can-compress'
import { compress } from './index'
import { downloadName, smallerName } from './compress-types'
import { SmallerCopyService } from '../smaller-copy.service'
import type { SmallerCopy } from '../smaller-copy.service'
import { sha256Hex } from '../../services/attachment-store.service'

/** ADR D-60 item 2 (revised 2026-10-17), E-194: the smaller-copy compressors, in a real browser. */
describe('smaller copies (compressors)', () => {

  /** A generated photo: nothing real, so nothing confidential. A gradient with light noise, as a camera's sensor gives. */
  async function makePng(width: number, height: number, noise = 6): Promise<File> {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(width, height)
    let seed = 12345
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const n = (seed % (noise * 2 + 1)) - noise
      const px = (i / 4) % width
      const py = Math.floor(i / 4 / width)
      image.data[i] = (px * 255 / width + n) & 255
      image.data[i + 1] = (py * 255 / height + n) & 255
      image.data[i + 2] = ((px + py) * 255 / (width + height) + n) & 255
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'))
    return new File([blob], 'generated.png', { type: 'image/png', lastModified: Date.UTC(2026, 9, 17, 10, 0) })
  }

  async function sizeOf(blob: Blob): Promise<{ width: number, height: number }> {
    const bitmap = await createImageBitmap(blob)
    const out = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return out
  }

  describe('canCompress', () => {
    const g = globalThis as any
    let savedVideo: unknown
    let savedAudio: unknown
    beforeEach(() => { savedVideo = g.VideoEncoder; savedAudio = g.AudioEncoder })
    afterEach(() => { g.VideoEncoder = savedVideo; g.AudioEncoder = savedAudio })

    const stub = (supported: (config: { codec: string }) => boolean) =>
      ({ isConfigSupported: async (config: { codec: string }) => ({ supported: supported(config), config }) })

    it('is true for a photo type and false for anything that is not photo, video or audio', async () => {
      expect(await canCompress('image/png')).toBeTrue()
      expect(await canCompress('application/pdf')).toBeFalse()
    })

    it('needs H.264 and a sound encoder for video', async () => {
      g.VideoEncoder = stub(c => c.codec.startsWith('avc1'))
      g.AudioEncoder = stub(c => c.codec === 'mp4a.40.2')
      expect(await canCompress('video/mp4')).toBeTrue()
      g.VideoEncoder = stub(() => false)
      expect(await canCompress('video/mp4')).toBeFalse()
      g.VideoEncoder = stub(() => true)
      g.AudioEncoder = stub(() => false)
      expect(await canCompress('video/mp4')).toBeFalse()
    })

    it('falls back to Opus when AAC is missing, for video and audio', async () => {
      g.VideoEncoder = stub(() => true)
      g.AudioEncoder = stub(c => c.codec === 'opus')
      expect(await canCompress('audio/mp4')).toBeTrue()
      expect(await canCompress('video/quicktime')).toBeTrue()
    })

    it('hides the offer when the browser has no encoders at all', async () => {
      g.VideoEncoder = undefined
      g.AudioEncoder = undefined
      expect(await canCompress('video/mp4')).toBeFalse()
      expect(await canCompress('audio/mpeg')).toBeFalse()
    })

    it('hides the offer for a photo the browser cannot decode (an odd type)', async () => {
      expect(await canCompressFile(new File([new Uint8Array(32)], 'x.heic', { type: 'image/heic' }))).toBeFalse()
    })
  })

  it('names the copy after the original with the new extension', () => {
    expect(smallerName('IMG_0042.HEIC', 'jpg')).toBe('IMG_0042.jpg')
    expect(smallerName('clip', 'mp4')).toBe('clip.mp4')
  })

  it('saves a smaller copy as NAME-smaller.ext and leaves other files alone', () => {
    expect(downloadName('IMG_0412.jpg', true)).toBe('IMG_0412-smaller.jpg')
    expect(downloadName('IMG_0412-smaller.jpg', true)).toBe('IMG_0412-smaller.jpg')
    expect(downloadName('clip', true)).toBe('clip-smaller')
    expect(downloadName('IMG_0412.jpg', false)).toBe('IMG_0412.jpg')
  })

  it('compresses a 3000x2000 PNG to a JPEG with its longest side at 2048', async () => {
    const png = await makePng(3000, 2000)
    const out = await compress(png, 'image')
    expect(out).not.toBeNull()
    expect(out!.type).toBe('image/jpeg')
    expect(out!.blob.type).toBe('image/jpeg')
    expect(out!.blob.size).toBeLessThan(png.size)
    const dims = await sizeOf(out!.blob)
    expect(Math.max(dims.width, dims.height)).toBe(2048)
    expect(dims.height).toBe(Math.round(2000 * 2048 / 3000))
  })

  it('returns null for a file the browser cannot decode, rather than throwing', async () => {
    const junk = new File([new Uint8Array(64)], 'junk.png', { type: 'image/png' })
    expect(await compress(junk, 'image')).toBeNull()
  })

  describe('SmallerCopyService.make', () => {
    const service = new SmallerCopyService()

    it('returns a smaller JPEG and the original\'s fingerprint, taken first', async () => {
      const png = await makePng(3000, 2000)
      const copy = await service.make(png) as SmallerCopy
      expect(typeof copy).toBe('object')
      expect(copy.file.type).toBe('image/jpeg')
      expect(copy.file.name).toBe('generated.jpg')
      expect(copy.file.lastModified).toBe(png.lastModified)
      expect(copy.compressed.fromSha256).toBe(await sha256Hex(await png.arrayBuffer()))
      expect(copy.compressed.fromSize).toBe(png.size)
      expect(copy.compressed.fromType).toBe('image/png')
      expect(service.job()).toBeNull()
    })

    it('keeps the original when the copy is not actually smaller', async () => {
      const tiny = await makePng(8, 8)
      expect(await service.make(tiny)).toBe('not-smaller')
    })

    it('says failed for a file it cannot read, and for a type it does not handle', async () => {
      expect(await service.make(new File([new Uint8Array(64)], 'junk.png', { type: 'image/png' }))).toBe('failed')
      expect(await service.make(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe('failed')
    })
  })

  describe('audio and video', () => {
    /** Three seconds of generated mono tone as 16-bit WAV: large, and nothing real. */
    function makeWav(seconds = 3, rate = 44100): File {
      const samples = seconds * rate
      const buffer = new ArrayBuffer(44 + samples * 2)
      const view = new DataView(buffer)
      const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
      text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
      text(36, 'data'); view.setUint32(40, samples * 2, true)
      for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 20) * 8000), true)
      return new File([buffer], 'generated.wav', { type: 'audio/wav' })
    }

    it('records which encoders this browser has (counts and states only)', async () => {
      const g = globalThis as any
      const has = {
        videoEncoder: typeof g.VideoEncoder === 'function',
        audioEncoder: typeof g.AudioEncoder === 'function',
        canVideo: await canCompress('video/mp4'),
        canAudio: await canCompress('audio/wav'),
      }
      console.log(`E-194 encoders in this browser: ${JSON.stringify(has)}`)
      expect(true).toBeTrue()
    })

    it('makes a smaller .m4a from audio when the browser can encode sound, else hides the offer', async () => {
      const wav = makeWav()
      if (!(await canCompress(wav.type))) {
        expect(await new SmallerCopyService().canOffer(wav)).toBeFalse()
        return
      }
      const out = await compress(wav, 'audio')
      expect(out).not.toBeNull()
      expect(out!.ext).toBe('m4a')
      expect(out!.type).toBe('audio/mp4')
      expect(out!.blob.size).toBeLessThan(wav.size)
    }, 90000)

    it('makes a smaller MP4, longest side 1280, from a 1080p clip when H.264 is available, else hides the offer', async () => {
      if (!(await canCompress('video/mp4'))) {
        expect(await new SmallerCopyService().canOffer(new File([new Uint8Array(8)], 'a.mp4', { type: 'video/mp4' }))).toBeFalse()
        return
      }
      // A generated 1080p clip, made with Mediabunny itself: moving blocks, nothing real.
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')!
      const made = new BufferTarget()
      // A .mov with its location in a user-data ©xyz atom, as an Android phone or ffmpeg writes it (made up).
      const output = new Output({ format: new MovOutputFormat(), target: made })
      const source = new CanvasSource(canvas, { codec: 'avc', bitrate: new Quality({ bitrate: 8_000_000 }) as any })
      output.addVideoTrack(source, { frameRate: 15 })
      output.setMetadataTags({ raw: { '©xyz': '+47.4400-122.4600/' } })
      await output.start()
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `hsl(${i * 12} 80% 50%)`
        ctx.fillRect(0, 0, 1920, 1080)
        ctx.fillStyle = '#000'
        for (let k = 0; k < 200; k++) ctx.fillRect((k * 97 + i * 31) % 1900, (k * 53) % 1060, 20, 20)
        await source.add(i / 15, 1 / 15)
      }
      await output.finalize()
      const clip = new File([made.buffer!], 'generated.mov', { type: 'video/quicktime' })

      let last = -1
      const out = await compress(clip, 'video', { onProgress: p => { last = p } })
      expect(out).not.toBeNull()
      expect(out!.type).toBe('video/mp4')
      expect(out!.ext).toBe('mp4')
      expect(out!.blob.size).toBeLessThan(clip.size)
      expect(last).toBeGreaterThan(0)
      const back = new Input({ formats: [MP4], source: new BlobSource(out!.blob) })
      const track = await back.getPrimaryVideoTrack()
      expect(Math.max(track!.displayWidth, track!.displayHeight)).toBe(1280)
      // John 2026-10-27: the location survives the copy, in the keyed form viewers read.
      expect((await back.getMetadataTags()).raw?.[LOCATION_KEY]).toBe('+47.4400-122.4600/')
      back.dispose()
    }, 90000)

    it('says failed, not hangs, for a "video" nothing can read', async () => {
      if (!(await canCompress('video/mp4'))) { expect(true).toBeTrue(); return }
      const junk = new File([new Uint8Array(2048)], 'junk.mp4', { type: 'video/mp4' })
      expect(await new SmallerCopyService().make(junk)).toBe('failed')
    }, 90000)

    it('Cancel stops a copy and reports cancelled, so the original is kept', async () => {
      if (!(await canCompress('audio/wav'))) { expect(true).toBeTrue(); return }
      const service = new SmallerCopyService()
      const pending = service.make(makeWav(20))
      service.cancel()
      expect(await pending).toBe('cancelled')
    }, 60000)
  })
})
