import { printAttachments } from '../../domain/attachments'
import type { Ics213Attachment } from '../export/ics213-pdf'
import type { AttachmentStoreService } from '../services/attachment-store.service'
import type { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'

/**
 * E-194 / ADR D-60: what a printed ICS-213 lists for an entry's attachments - name and short
 * fingerprint for each live one, plus the stored (EXIF-free) thumbnail for an image. Shared by
 * Entry's auto-print and Messages' Print / Save PDF so both print the same list.
 */
export async function ics213AttachmentsFor(
  entry: Pick<RadioLogEntryType, 'attachments'>, store: AttachmentStoreService,
): Promise<Ics213Attachment[]> {
  const out: Ics213Attachment[] = []
  for (const a of printAttachments(entry)) {
    let thumbJpeg: Uint8Array | undefined
    if (a.isImage) {
      const blob = await store.getThumb(a.sha256).catch(() => undefined)
      if (blob) thumbJpeg = new Uint8Array(await blob.arrayBuffer())
    }
    out.push({ name: a.name, fingerprint: a.fingerprint, ...(a.smallerCopy ? { smallerCopy: a.smallerCopy } : {}), ...(thumbJpeg ? { thumbJpeg } : {}) })
  }
  return out
}
