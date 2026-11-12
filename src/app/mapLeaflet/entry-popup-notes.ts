/**
 * Q14.4 (Advanced Tour, John 2026-11-11): a ranger's reported fact lives in the entry's Notes, so the
 * Map popup shows it. Long notes start clamped to a few lines with a "More" button that expands them
 * in place (and "Less" to fold back), so the Ops chief reads the whole fact without leaving the Map.
 *
 * Built with textContent only: notes are free text typed at another station, never markup.
 * Styles are set through element.style (CSSOM), which the site's CSP allows; Leaflet popups sit
 * outside the component's view encapsulation, so a component stylesheet would not reach them.
 */

/** Lines shown before "More". */
export const POPUP_NOTE_LINES = 3

/** A note longer than this, or with more lines than POPUP_NOTE_LINES, gets the More button. */
export const POPUP_NOTE_CHARS = 140

export function noteIsLong(text: string): boolean {
  return text.length > POPUP_NOTE_CHARS || text.split('\n').length > POPUP_NOTE_LINES
}

/**
 * The Notes block for an entry popup, or null when the entry has no notes.
 * `onResize` runs after More/Less, so the caller can let Leaflet re-measure the popup.
 */
export function popupNotesBlock(notes: string | undefined, onResize: () => void = () => {}): HTMLElement | null {
  const text = (notes ?? '').trim()
  if (!text) return null

  const block = document.createElement('div')
  block.className = 'rt-popup-notes'
  block.style.cssText = 'margin-top:6px;max-width:260px'

  const body = document.createElement('div')
  body.className = 'rt-popup-notes__text'
  body.textContent = text
  body.style.whiteSpace = 'pre-wrap'
  body.style.overflowWrap = 'anywhere'
  block.append(body)

  if (!noteIsLong(text)) return block

  const clamp = (on: boolean) => {
    // -webkit-line-clamp works in Chrome, Edge, Safari and Firefox.
    body.style.display = on ? '-webkit-box' : 'block'
    body.style.setProperty('-webkit-box-orient', on ? 'vertical' : '')
    body.style.setProperty('-webkit-line-clamp', on ? String(POPUP_NOTE_LINES) : '')
    body.style.overflow = on ? 'hidden' : 'auto'
    body.style.maxHeight = on ? '' : '40vh'
  }
  clamp(true)

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'rt-popup-notes__more'
  more.textContent = 'More'
  more.setAttribute('aria-expanded', 'false')
  more.style.cssText = 'margin-top:2px;padding:0;border:0;background:none;color:inherit;'
    + 'text-decoration:underline;cursor:pointer;font:inherit'
  more.addEventListener('click', event => {
    event.stopPropagation()   // the popup's own click handler opens attachments
    const open = more.getAttribute('aria-expanded') !== 'true'
    clamp(!open)
    more.textContent = open ? 'Less' : 'More'
    more.setAttribute('aria-expanded', String(open))
    onResize()
  })
  block.append(more)
  return block
}
