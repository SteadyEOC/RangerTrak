import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { firstValueFrom } from 'rxjs'

import { LogService } from '../services'
import { MATERIAL_IMPORTS } from '../../material-imports'

const GITHUB_ISSUE_URL = 'https://github.com/SteadyEOC/RangerTrak/issues/new'

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
 * Deliberately never reads mission data (settings, rangers, field reports) - the message
 * and optional contact field are the only things sent, both typed by hand.
 */
@Component({
  selector: 'rangertrak-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FeedbackComponent {
  private id = 'Feedback Component'

  message = ''
  contact = ''

  status = signal<'idle' | 'sending' | 'success' | 'error'>('idle')
  successUrl = signal('')

  constructor(private http: HttpClient, private log: LogService) { }

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

    try {
      const response = await firstValueFrom(
        this.http.post<{ url: string }>('/api/feedback', {
          message: this.message.trim(),
          contact: this.contact.trim(),
        })
      )
      this.successUrl.set(response.url)
      this.status.set('success')
      this.log.info(`Feedback submitted: ${response.url}`, this.id)
    } catch (e) {
      this.status.set('error')
      this.log.error(`Feedback submission failed, falling back to a direct GitHub link: ${e}`, this.id)
    }
  }

  /** Lets the disclosure re-open to a clean form after a successful submission. */
  reset(): void {
    this.message = ''
    this.contact = ''
    this.status.set('idle')
    this.successUrl.set('')
  }
}
