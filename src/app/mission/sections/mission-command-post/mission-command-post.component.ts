import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Input, OnDestroy, signal } from '@angular/core'
import { FieldTree, FormField } from '@angular/forms/signals'

import { LogService, MissionType } from '../../../shared/services/'
import { CommandPostPublishService } from '../../../shared/services/command-post-publish.service'
import { BOARD_HTTP_ERROR, BOARD_LOCALHOST_HINT, BOARD_VIEW_HINT, normaliseBoardAddress } from '../../../domain/board-address'
import { replacedMessage } from '../../../domain/board-client'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/**
 * E-87 Stage 1 (2026-08-31): the opt-in publish-to-Command-Post-Server setting. See
 * `command-post-publish.service.ts`'s own header comment for the full design (the roster
 * never goes over the wire, a failed publish is silent/non-fatal, no join code in this v1).
 *
 * Own small section, same reasoning as mission-recipients213/mission-maps-section splitting
 * out of the monolithic mission.component template - this is a genuinely separate concern
 * (LAN publishing) from the settings around it, not a natural fit inside Advanced Options
 * (which is specifically the destructive/replace-your-data section; this is neither).
 */
@Component({
  selector: 'rangertrak-mission-command-post',
  standalone: true,
  imports: [CommonModule, FormField, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatCardModule, AdvancedDirective, MatSlideToggleModule],
  templateUrl: './mission-command-post.component.html',
  styleUrls: ['./mission-command-post.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionCommandPostComponent implements OnDestroy {
  @Input({ required: true }) form!: FieldTree<MissionType>

  constructor(private log: LogService, public publisher: CommandPostPublishService) {
    this.phoneMediaQuery.addEventListener('change', this.onPhoneMediaChange)
  }

  /**
   * Asked directly, 2026-08-31: "does the mission section explain it won't work, just on a
   * laptop running an OS - if running on a smartphone?" Before this it only ever said so in
   * generic prose (the note above, "on a command-post laptop... a phone or tablet can publish
   * ... but cannot run the server itself"), true for every reader but not TARGETED at someone
   * actually reading it on a phone right now. Same breakpoint/pattern `radio-log.component.ts`'s
   * own `isPhone` already established (`(max-width: 575px)`, matching `_breakpoints.scss`'s
   * `phone` mixin) - reused rather than a second detection mechanism - drives an extra,
   * specific callout in the template for that case, on top of the general explanation, which
   * stays because it's also what a LAPTOP user reads when wondering whether a teammate's phone
   * could run this instead.
   */
  private phoneMediaQuery = window.matchMedia('(max-width: 575px)')
  isPhone = signal(this.phoneMediaQuery.matches)
  private onPhoneMediaChange = (e: MediaQueryListEvent) => this.isPhone.set(e.matches)

  /**
   * D-61 / E-216: what the Board is doing, in words, for the line under the switch. Four states only:
   * Connected, Trying, Can't reach the Board (the cause follows, from `statusMessage()`), and Another device has it.
   */
  boardStatus(): string {
    switch (this.publisher.state()) {
      case 'claiming': return this.publisher.unreachable() ? "Can't reach the Board." : 'Trying to reach the Board...'
      case 'publishing': return 'Connected to the Board.'
      case 'replaced': return replacedMessage(this.publisher.holder())
      default: return this.publisher.unreachable() ? "Can't reach the Board." : ''
    }
  }

  /** The cause sentence under the status. Left out when the diagnosis block below already says the same thing. */
  statusMessage(): string {
    const m = this.publisher.message()
    return m && m !== this.publisher.diagnosis()?.message ? m : ''
  }

  /** E-216: the Test connection button. The result shows in the diagnosis block under it. */
  async testConnection(): Promise<void> {
    await this.publisher.testConnection(this.form.commandPostServerUrl().value())
  }

  ngOnDestroy(): void {
    this.phoneMediaQuery.removeEventListener('change', this.onPhoneMediaChange)
  }

  /**
   * Raised live 2026-08-31: "does the entry field explain it & maybe display it so it can be
   * copy/pasted elsewhere in the future?" - the server address only ever lived in the
   * console's own scrollback and whatever got typed into the field once; nothing let the
   * operator grab it back out of RangerTrak itself later (hours in, to tell a new viewer, with
   * the terminal window long since scrolled past or closed). Same `navigator.clipboard.
   * writeText()` idiom `location.component.ts`'s `copyCoordinate()` already established for
   * exactly this "click a read-only value to copy it" need, reused rather than invented fresh
   * - including its `.catch()`, since clipboard access can be refused (insecure context, a
   * permissions policy) and a silent failure would leave the operator believing a copy
   * happened when it didn't.
   */
  copiedField = signal<'address' | 'view' | null>(null)

  /**
   * Asked directly, 2026-08-31: should the copy buttons go disabled/inactive with a note on
   * browsers where they cannot work, smartphones included? Checked rather than assumed: a
   * BLANKET phone check would be wrong (modern mobile Safari/Chrome support
   * `navigator.clipboard.writeText()` fine) - the real, narrower condition is whether the API
   * itself exists at all, which is also the gap `copyToClipboard()` had before this: calling
   * `.writeText()` when `navigator.clipboard` is undefined throws SYNCHRONOUSLY, before any
   * Promise exists to `.catch()` - an uncaught error, not the graceful failure the `.catch()`
   * below only handles the (much more common) case of - permission refused, not API absent.
   */
  clipboardAvailable = typeof navigator !== 'undefined'
    && typeof navigator.clipboard?.writeText === 'function'

  /**
   * Reported live 2026-08-31, v0.90: "copy didn't seem to work." The real bug, found by
   * re-reading this rather than guessing at a browser quirk: a failed `writeText()` only ever
   * logged to the Log page - nowhere a user testing a button would think to look. Silent
   * failure and silent success looked identical from the button itself. `clipboardAvailable`
   * only confirms the API EXISTS; the write can still be refused at call time (a permissions
   * policy, an unfocused document, a one-off browser quirk), and now that case is visible -
   * same `alert()` convention this app already uses for every other user-facing failure
   * (mission-zip.ts, report-packet.ts, setup-file.component.ts).
   */
  copyToClipboard(field: 'address' | 'view', value: string): void {
    if (!this.clipboardAvailable) {
      return // button is disabled in this state - see the template - but guard here too
    }
    navigator.clipboard.writeText(value)
      .then(() => {
        this.copiedField.set(field)
      })
      .catch(err => {
        this.log.error(`Command Post ${field} NOT copied to clipboard, error: ${err}`, 'Mission Command Post')
        alert(`Could not copy to the clipboard. Select the text and copy it manually.\n\n${value}`)
      })
  }

  /**
   * Raised live 2026-08-31: "a URL to click" alongside the address field, so the operator can
   * confirm the /view page actually works without hand-typing it into a second tab. Doubles
   * as the one-time certificate-acceptance step now that the server is self-signed HTTPS (see
   * `command-post-server.js`'s own `getOrCreateCert()` comment for why): clicking this link IS
   * the direct visit that shows the browser's "not private" prompt, which must be accepted
   * once before `CommandPostPublishService`'s own `fetch()` can succeed. Still deliberately a
   * plain `<a>`, not a live reachability ping - a fetch()-based check would need that SAME
   * one-time acceptance first, so it could never distinguish "not accepted yet" from "actually
   * down," and would be misleading either way until a device has clicked through once.
   */
  viewUrl(): string {
    const base = this.address().url
    return base ? `${base}/view` : ''
  }

  /** E-216: the cleaned address, or the reason it can't be used. */
  private address() {
    return normaliseBoardAddress(this.form.commandPostServerUrl().value())
  }

  /** E-216: the Open the Board button's target - the page that holds no data. */
  helloUrl(): string {
    const base = this.address().url
    return base ? `${base}/hello` : ''
  }

  /** E-216: shown once, when a pasted viewer address had /view taken off. */
  viewHint = signal(false)
  readonly viewHintText = BOARD_VIEW_HINT

  /** E-216: tidy the address when the scribe leaves the field. http:// is left as typed, with the error showing. */
  tidyAddress(): void {
    const r = this.address()
    if (r.url === undefined) return
    if (r.url !== this.form.commandPostServerUrl().value()) this.form.commandPostServerUrl().value.set(r.url)
    this.viewHint.set(!!r.strippedView)
  }

  entersPlainHttp(): boolean {
    return this.address().error !== undefined
  }

  readonly httpError = BOARD_HTTP_ERROR

  /** John, 2026-10-28: with the Board on this computer, `localhost` publishes fine but makes a viewer link nobody else can open. */
  thisComputerOnly(): boolean {
    return !!this.address().thisComputerOnly
  }

  readonly localhostHint = BOARD_LOCALHOST_HINT

  /** E-255: the Board kit is attached to each GitHub release, beside the web zip. */
  readonly boardKitUrl = 'https://github.com/SteadyEOC/RangerTrak/releases/latest'
}
