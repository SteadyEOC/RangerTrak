import { Location } from '@angular/common'
import { Injectable, inject } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router } from '@angular/router'

import { POPOUT_PARAM } from '../storage/read-only-window'
import { DISPLAY_PARAM } from './display.service'

/** The pieces of the Window Management API this uses (Chrome and Edge only). */
interface ScreenDetailed { availLeft: number; availTop: number; availWidth: number; availHeight: number }
interface ScreenDetails { screens: ScreenDetailed[]; currentScreen: ScreenDetailed }
type WindowWithScreenDetails = Window & { getScreenDetails?: () => Promise<ScreenDetails> }

/**
 * E-313 / ADR D-71: the Pop out button. Opens the page on screen, with its filters and query
 * parameters, as a read-only window (`?display=1&popout=1`): its own window, for a second monitor or
 * a projector. Each click opens another one, so Rangers and the Map can sit side by side. The new
 * window takes no tab lock, writes nothing, and keeps up with this one by itself (PopOutSyncService).
 *
 * Placement: on Chrome and Edge, with more than one screen, the Window Management API puts the new
 * window full size on a screen other than this one (one permission prompt, the first time). Refused or
 * missing (Firefox, Safari, one screen): a plain pop-up window, which the operator moves themselves.
 *
 * Nothing about a pop-out is stored (D-71): this keeps no list of the windows it opened.
 */
@Injectable({ providedIn: 'root' })
export class PopOutService {
  private readonly router = inject(Router)
  private readonly location = inject(Location)
  private readonly snackbar = inject(MatSnackBar)
  private count = 0

  /** The address a pop-out of the page on screen opens: same route and parameters, plus the two flags. */
  popOutUrl(): string {
    const tree = this.router.parseUrl(this.router.url)
    tree.queryParams = { ...tree.queryParams, [DISPLAY_PARAM]: '1', [POPOUT_PARAM]: '1' }
    return new URL(this.location.prepareExternalUrl(this.router.serializeUrl(tree)), location.origin).toString()
  }

  /** Opens one more pop-out. Call from a click: browsers only allow a new window then. */
  async open(): Promise<void> {
    const url = this.popOutUrl()
    // A name no other pop-out has, so each click is a new window and not a reuse of an earlier one.
    const name = `rangertrak-popout-${Date.now()}-${++this.count}`
    const features = await this.placement()
    const opened = window.open(url, name, features)
    if (!opened) {
      this.snackbar.open('The browser blocked the new window. Allow pop-ups for this site, then try again.', 'Dismiss', { duration: 8000 })
    }
  }

  /** `window.open` features: another screen when the browser can say where it is, else a plain pop-up. */
  private async placement(): Promise<string> {
    const plain = 'popup=yes,width=1280,height=800'
    const w = window as WindowWithScreenDetails
    // screen.isExtended is true only with more than one screen; no point asking for permission on one.
    if (typeof w.getScreenDetails !== 'function' || !(screen as Screen & { isExtended?: boolean }).isExtended) return plain
    try {
      const details = await w.getScreenDetails()
      const other = details.screens.find(s => s !== details.currentScreen && s.availLeft !== details.currentScreen.availLeft)
        ?? details.screens.find(s => s !== details.currentScreen)
      if (!other) return plain
      return `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`
    } catch {
      return plain // permission refused, or the API is blocked here
    }
  }
}
