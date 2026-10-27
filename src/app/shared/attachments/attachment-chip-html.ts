import { liveRefs } from '../../domain/attachments'
import { escapeHtml } from '../escape-html'
import type { RadioLogEntryType } from '../services/radio-log-entry.interface'

/** Hook class the grid's click handler looks for; the entry's uid rides in `data-entry-uid`. */
export const ATTACH_CHIP_CLASS = 'rt-attach-chip'

/**
 * The 📎 N chip as a string, for the places that build their own markup: the AG Grid notes cell
 * and the Leaflet popup. '' when the entry has no live attachments. The uid is a UUID the app
 * minted, but it is escaped anyway because an imported file chose it. The click is NOT wired
 * here; the host catches clicks on `.rt-attach-chip` and opens the viewer (see
 * `attachmentChipUid`).
 */
export function attachmentChipHtml(entry: Pick<RadioLogEntryType, 'uid' | 'attachments'>): string {
  const n = liveRefs(entry).length
  if (!n || !entry.uid) return ''
  const uid = escapeHtml(entry.uid)
  return `<button type="button" class="${ATTACH_CHIP_CLASS}" data-entry-uid="${uid}" `
    + `aria-label="${n} ${n === 1 ? 'attachment' : 'attachments'}, open">📎 ${n}</button>`
}

/** The entry uid of a chip the click landed on, or undefined when it landed elsewhere. */
export function attachmentChipUid(event: Event): string | undefined {
  const chip = (event.target as HTMLElement | null)?.closest?.(`.${ATTACH_CHIP_CLASS}`) as HTMLElement | null
  return chip?.dataset['entryUid'] || undefined
}
