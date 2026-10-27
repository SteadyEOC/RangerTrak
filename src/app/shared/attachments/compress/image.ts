import { CompressCancelledError, IMAGE_MAX_EDGE, IMAGE_QUALITY } from './compress-types'
import type { CompressOptions, CompressResult } from './compress-types'
import { readExif, writeExif } from './exif'

/**
 * A photo, redrawn through a canvas: longest side at most 2048 px, JPEG at quality 0.85. A canvas
 * holds pixels only, so the photo's own EXIF (location, capture time, camera) is read from the
 * original and written back into the copy (`exif.ts`), wherever the original has one we can read.
 * EXIF orientation is applied while decoding, so a phone photo is not turned on its side.
 * Null when the browser cannot decode the file (HEIC on Chrome, say).
 */
export async function compressImage(file: Blob, options: CompressOptions = {}): Promise<CompressResult | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    if (options.signal?.aborted) throw new CompressCancelledError()
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG has no transparency: a transparent PNG would turn black without this.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
    if (!blob) return null
    return { blob: await withOriginalExif(file, blob, canvas.width, canvas.height), type: 'image/jpeg', ext: 'jpg' }
  } finally {
    bitmap.close?.()
  }
}

/** The copy with the original's EXIF in it; the copy as made when there is none, or it can't be carried. */
async function withOriginalExif(original: Blob, copy: Blob, width: number, height: number): Promise<Blob> {
  const tiff = readExif(new Uint8Array(await original.arrayBuffer()))
  if (!tiff) return copy
  const out = writeExif(new Uint8Array(await copy.arrayBuffer()), tiff, width, height)
  return out ? new Blob([out as BlobPart], { type: 'image/jpeg' }) : copy
}
