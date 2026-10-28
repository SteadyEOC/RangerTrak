import { ErrorHandler, inject, Injectable, Injector } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router } from '@angular/router'

import { redact } from '../redact'
import { LogService } from './log.service'

/**
 * Routes otherwise-invisible failures into the in-app Log page.
 *
 * Until this existed the Log only ever contained what code explicitly chose to log, so the
 * single most useful thing in a trouble report - the exception that actually broke the
 * screen - was the one thing missing from it. A scribe on a field tablet has no devtools,
 * so an uncaught error simply looked like "the page stopped working".
 *
 * Covers all three routes a failure can take:
 *  - Angular's own error path (this class, via the ErrorHandler token)
 *  - uncaught exceptions outside Angular (`window.onerror`)
 *  - rejected promises nobody caught (`unhandledrejection`) - especially relevant in a
 *    zoneless app, where those do not necessarily reach Angular's handler
 */
@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {

  private id = 'Unhandled Error'
  private log = inject(LogService)
  // E-258: Router and MatSnackBar are fetched lazily from this - injecting them here would
  // make the ErrorHandler depend on services that can themselves be mid-construction when an
  // error is thrown (a circular DI at startup).
  private injector = inject(Injector)
  private lastPromptAt = 0

  constructor() {
    window.addEventListener('error', (ev: ErrorEvent) => {
      this.record(ev.error ?? ev.message, 'window.onerror')
    })

    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
      this.record(ev.reason, 'unhandled promise rejection')
    })
  }

  handleError(error: unknown): void {
    this.record(error, 'Angular ErrorHandler')

    // Still surface it the normal way: the console keeps the live, clickable stack trace,
    // which is more useful than our flattened copy whenever devtools are actually open.
    console.error(error)
  }

  private record(error: unknown, origin: string): void {
    // Never let logging an error throw an error - that recurses straight into this handler.
    try {
      this.log.error(`${origin}: ${this.describe(error)}`, this.id)
    } catch {
      console.error('GlobalErrorHandler failed to record an error', error)
    }
    this.offerReport(error)
  }

  /**
   * E-258 (2026-10-28): replaces the old Debug mode as the way a problem reaches the developers.
   * At most one prompt a minute (an error loop must not bury the screen). The draft carries only
   * the first line of the error, redacted; the diagnostic report box is pre-ticked but nothing is
   * sent until the person presses Send. Can never throw.
   */
  private offerReport(error: unknown): void {
    try {
      const now = Date.now()
      if (now - this.lastPromptAt < 60_000) {
        return
      }
      this.lastPromptAt = now
      const first = (error instanceof Error ? error.message : String(error ?? '')).split('\n')[0]
      const draft = 'Something went wrong:\n' + redact(first).slice(0, 300) + '\n\nWhat I was doing: '
      this.injector.get(MatSnackBar)
        .open('Something went wrong.', 'Report it', { duration: 15000 })
        .onAction().subscribe(() => {
          try {
            this.injector.get(Router).navigate(['/help'], {
              queryParams: { tab: 'feedback' },
              state: { feedbackDraft: draft, includeDiagnostics: true },
            })
          } catch { /* never throw from the error path */ }
        })
    } catch {
      // Nothing more to do: the error is already in the Log.
    }
  }

  private describe(error: unknown): string {
    if (error instanceof Error) {
      // The stack is the point of capturing this at all, but a full trace crowds out every
      // other line on the Log page, so keep the top few frames.
      const stack = error.stack?.split('\n').slice(0, 5).join(' | ') ?? '(no stack)'
      return `${error.name}: ${error.message} — ${stack}`
    }
    if (typeof error === 'string') {
      return error
    }
    // Not JSON.stringify(error): a thrown plain object can carry anything, including entry text.
    return error && typeof error === 'object'
      ? `a thrown ${(error as object).constructor?.name ?? 'object'} (not an Error)`
      : String(error)
  }
}
