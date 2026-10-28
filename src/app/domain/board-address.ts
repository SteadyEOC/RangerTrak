/**
 * E-216 slice 1: tidy up the address a scribe types for the Board. Pure, so it can be tested
 * without a browser. Pasting the viewer's address (".../view") is the commonest slip.
 */

export const BOARD_HTTP_ERROR = 'Use https:// — RangerTrak is on https, so the browser blocks plain http.'
export const BOARD_VIEW_HINT = 'That was the viewer\'s address. The scribe uses the same address without /view.'
export const BOARD_LOCALHOST_HINT = 'That address only works on this computer, so the viewer link below won\'t open for anyone else. Use the rangertrak-board.local or numbered address the Board printed instead.'

export type BoardAddress = {
  /** The cleaned address; '' when nothing was typed. Absent when there is an error. */
  url?: string
  error?: string
  /** True when a trailing /view was removed, so the screen can say why the text changed. */
  strippedView?: boolean
  /** True for localhost / 127.x / [::1]: publishing works when the Board is on this computer, but the viewer link is useless to anyone else. */
  thisComputerOnly?: boolean
}

const TRAILING = /\/+(view|qr|hello)?\/*$/i
const LOOPBACK = /^https:\/\/(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/i

export function normaliseBoardAddress(raw: string | null | undefined): BoardAddress {
  let s = (raw ?? '').trim()
  if (!s) return { url: '' }
  if (/^http:\/\//i.test(s)) return { error: BOARD_HTTP_ERROR }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  let strippedView = false
  for (;;) {
    const m = TRAILING.exec(s)
    if (!m || m[0] === '') break
    if (m[1]?.toLowerCase() === 'view') strippedView = true
    s = s.slice(0, m.index)
  }
  return { url: s, ...(strippedView ? { strippedView } : {}), ...(LOOPBACK.test(s) ? { thisComputerOnly: true } : {}) }
}
