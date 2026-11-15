// SPDX-License-Identifier: AGPL-3.0-or-later
import { unzipSync } from 'fflate'

/**
 * E-295: what Rangers > Import photos accepts. The picker takes loose pictures, a zip of pictures,
 * or a whole folder, and every file it leaves out is listed with the reason, so a person is never
 * left wondering why 40 pictures became 31. Pure apart from reading the File objects, so the
 * rules are tested without a browser picker.
 */

/** A file the import left out, and why, in words the person can act on. */
export interface SkippedPhotoFile { name: string, reason: string }

export interface PhotoIntake { images: File[], skipped: SkippedPhotoFile[] }

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
/** One picture bigger than this is left out of a zip rather than unpacked (a damaged or hostile zip). */
export const MAX_PHOTO_BYTES_IN_ZIP = 30 * 1024 * 1024

const extensionOf = (name: string): string => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

export function isZipFile(file: { name: string, type?: string }): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
}

function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(name))
}

function mimeFor(name: string): string {
  const ext = extensionOf(name)
  return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp'
    : ext === 'bmp' ? 'image/bmp' : ext === 'avif' ? 'image/avif' : 'image/jpeg'
}

/** Hidden files a Mac's Finder or Windows adds beside the real ones; they are not the person's pictures. */
function isSystemJunk(path: string): boolean {
  const name = baseName(path)
  return /(^|[\\/])__MACOSX[\\/]/.test(path) || name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db'
}

/** Why a non-picture was left out. */
function notAPicture(name: string): string {
  const ext = extensionOf(name)
  return ext ? `not a picture (.${ext})` : 'not a picture'
}

/**
 * Sorts what was picked into pictures to import and files to skip, with reasons.
 * - a zip is opened and its pictures used (folders inside it are fine);
 * - a folder pick arrives as its files, subfolders included, and goes through the same rules;
 * - the same file name twice keeps the first, because the name is what matches a ranger.
 */
export async function intakePhotoFiles(picked: File[]): Promise<PhotoIntake> {
  const images: File[] = []
  const skipped: SkippedPhotoFile[] = []
  const seen = new Set<string>()

  const accept = (file: File): void => {
    const key = file.name.toUpperCase()
    if (seen.has(key)) { skipped.push({ name: file.name, reason: 'another picture has the same name' }); return }
    seen.add(key)
    images.push(file)
  }

  for (const file of picked) {
    const label = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    if (isSystemJunk(label)) continue
    if (isZipFile(file)) {
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: entry => {
            if (entry.name.endsWith('/') || isSystemJunk(entry.name)) return false
            const inside = `${file.name} > ${baseName(entry.name)}`
            if (!isImageName(entry.name)) { skipped.push({ name: inside, reason: notAPicture(entry.name) }); return false }
            if (entry.originalSize > MAX_PHOTO_BYTES_IN_ZIP) { skipped.push({ name: inside, reason: 'too large' }); return false }
            return true
          },
        })
        for (const [path, bytes] of Object.entries(entries)) {
          const name = baseName(path)
          accept(new File([bytes as BlobPart], name, { type: mimeFor(name) }))
        }
      } catch {
        skipped.push({ name: file.name, reason: 'could not be opened as a zip file' })
      }
      continue
    }
    if (isImageName(file.name) || (file.type.startsWith('image/') && file.type !== 'image/svg+xml')) {
      accept(file)
    } else {
      skipped.push({ name: label, reason: notAPicture(file.name) })
    }
  }
  return { images, skipped }
}

/** The lines the confirmation shows for skipped files: up to `max` of them, then a count of the rest. */
export function describeSkipped(skipped: SkippedPhotoFile[], max = 8): string[] {
  if (!skipped.length) return []
  const lines = skipped.slice(0, max).map(s => `${s.name}: ${s.reason}`)
  if (skipped.length > max) lines.push(`...and ${skipped.length - max} more`)
  return lines
}
