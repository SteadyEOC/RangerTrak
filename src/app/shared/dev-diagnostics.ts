import { isDevMode } from '@angular/core'

/**
 * E-258 (2026-10-28): the developer-only switch that replaced the saved "Debug mode" setting.
 * True in a dev build, or when the page is opened with `?debug` on the address. Read once and
 * never saved anywhere, so it cannot be left on by accident on a field device, and a returning
 * user's stored settings play no part in it.
 */
const DEV_DIAGNOSTICS = isDevMode()
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))

export const devDiagnostics = (): boolean => DEV_DIAGNOSTICS
