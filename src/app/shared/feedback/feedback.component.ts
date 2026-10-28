import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, Injector, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { firstValueFrom } from 'rxjs'

import { LogService } from '../services'
import { MissionJournalService } from '../services/mission-journal.service'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { DiagnosticsService } from '../services/diagnostics.service'

const GITHUB_ISSUE_URL = 'https://github.com/SteadyEOC/RangerTrak/issues/new'

/** The Worker's cap on `message` (worker/index.js FEEDBACK_MESSAGE_MAX). */
const MESSAGE_MAX = 4000
const DIAGNOSTICS_HEADER = '\n\n---\nDiagnostics\n'

/**
 * ADR D-15: in-app feedback. Submits to the Worker's `POST /api/feedback` (worker/
 * index.js), which files a labeled GitHub issue on the public repo - decided 2026-08-20,
 * "public issues, as-is... standard for an open-source project," so this states that
 * plainly before anyone submits rather than leaving it implicit.
 *
 * On failure (network error, or the Worker's own 503/502 - e.g. the GITHUB_FEEDBACK_TOKEN
 * secret missing) this falls back to a direct link into GitHub's own "new issue" form,
 * pre-filled with whatever was typed via query params, so nothing the user wrote is lost.
 * No mailto fallback here: RangerTrak@steadyeoc.com is offered elsewhere (Help > About/
 * Feedback), and the direct GitHub link already covers "reach us on GitHub two ways."
 *
 * The one exception (E-116): the After Action page can pass a draft of its notes about
 * RangerTrak through router navigation state. It lands in the message box for the user to edit,
 * and is only sent if they press Submit.
 *
 * Otherwise never reads mission data (settings, rangers, radio log entries) - the message
 * and optional contact field are the only things sent, both typed by hand.
 */
@Component({
  selector: 'rangertrak-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCheckboxModule],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FeedbackComponent {
  private id = 'Feedback Component'

  // E-116: a draft handed over by the After Action page's "Review and send" (router state).
  message = typeof history !== 'undefined' && typeof history.state?.feedbackDraft === 'string'
    ? history.state.feedbackDraft : ''
  contact = ''

  // E-258 (2026-10-28): the opt-in diagnostic report (see DiagnosticsService for what it holds
  // and, as important, what it leaves out). Off unless the person ticks it, or the "Report it"
  // prompt after an error pre-ticks it via router state - still sent only on Send.
  includeDiagnostics = typeof history !== 'undefined' && history.state?.includeDiagnostics === true
  showPreview = signal(false)
  report = signal('')
  copied = signal(false)

  status = signal<'idle' | 'sending' | 'success' | 'error'>('idle')
  successUrl = signal('')

  private journal = inject(MissionJournalService)

  // Lazy: the report pulls in the roster, radio log and place services, which the form
  // otherwise never touches.
  private injector = inject(Injector)

  constructor(private http: HttpClient, private log: LogService) {
    if (this.includeDiagnostics) {
      void this.refreshReport()
    }
  }

  async refreshReport(): Promise<void> {
    try {
      this.report.set(await this.injector.get(DiagnosticsService).report())
    } catch (e) {
      this.report.set('(diagnostic report unavailable)')
      this.log.warn(`Could not build the diagnostic report: ${e}`, this.id)
    }
  }

  async onToggleDiagnostics(checked: boolean): Promise<void> {
    this.includeDiagnostics = checked
    if (checked) {
      await this.refreshReport()
    }
  }

  async onTogglePreview(): Promise<void> {
    if (!this.showPreview()) {
      await this.refreshReport()
    }
    this.showPreview.update(v => !v)
  }

  async onCopyDiagnostics(): Promise<void> {
    await this.refreshReport()
    try {
      await navigator.clipboard.writeText(this.report())
      this.copied.set(true)
      setTimeout(() => this.copied.set(false), 3000)
    } catch (e) {
      this.log.warn(`Could not copy the diagnostic report: ${e}`, this.id)
    }
  }

  /**
   * The text sent: what the person typed, plus the report when ticked. The report is trimmed to
   * fit the Worker's cap; the person's own words never are.
   */
  get outgoingMessage(): string {
    const text = this.message.trim()
    if (!this.includeDiagnostics || !this.report()) {
      return text
    }
    const room = MESSAGE_MAX - text.length - DIAGNOSTICS_HEADER.length
    return room > 0 ? text + DIAGNOSTICS_HEADER + this.report().slice(0, room) : text
  }

  get canSubmit(): boolean {
    return this.message.trim().length > 0 && this.status() !== 'sending'
  }

  get fallbackUrl(): string {
    const params = new URLSearchParams({ labels: 'feedback' })
    if (this.message.trim()) {
      params.set('body', this.contact.trim()
        ? `${this.message.trim()}\n\n---\nContact: ${this.contact.trim()}`
        : this.message.trim())
    }
    return `${GITHUB_ISSUE_URL}?${params.toString()}`
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit) {
      return
    }

    this.status.set('sending')
    this.log.verbose('Submitting feedback', this.id)

    // Build the report fresh so it shows the moments just before Send (skipped when unticked,
    // which keeps the plain path synchronous).
    if (this.includeDiagnostics) {
      await this.refreshReport()
    }

    try {
      const response = await firstValueFrom(
        this.http.post<{ url: string }>('/api/feedback', {
          message: this.outgoingMessage,
          contact: this.contact.trim(),
        })
      )
      this.successUrl.set(response.url)
      this.status.set('success')
      this.journal.record('feedback-sent', `Sent feedback to the developers: ${response.url}`)
    } catch (e) {
      this.status.set('error')
      this.log.error(`Feedback submission failed, falling back to a direct GitHub link: ${e}`, this.id)
    }
  }

  /** Lets the disclosure re-open to a clean form after a successful submission. */
  reset(): void {
    this.message = ''
    this.contact = ''
    this.includeDiagnostics = false
    this.showPreview.set(false)
    this.status.set('idle')
    this.successUrl.set('')
  }
}
