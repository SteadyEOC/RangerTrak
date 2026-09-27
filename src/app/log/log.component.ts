import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef, signal, viewChild
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatCardModule } from '@angular/material/card'
import { MatButtonModule } from '@angular/material/button'

import { PageComponent } from '../shared/page/page.component'
import { Utility } from '../shared'
import { LogLevel, LogService, LogType } from '../shared/services/'

/**
 * Displays the in-app event log.
 *
 * Rewritten to render through the Angular template rather than by assembling
 * `innerHTML` by hand, which fixed three separate problems at once:
 *
 *  - **Injection.** Entry text went into `innerHTML` unescaped, and log messages carry
 *    free-text ranger notes and serialized radio log entries - so a note containing markup
 *    executed. Interpolation escapes automatically.
 *  - **Performance.** Every new entry cleared the panel and re-rendered *every* entry, so
 *    cost grew quadratically over a session. `@for` with a stable `track` now updates only
 *    what changed.
 *  - **Styling.** The old code's own comment noted that its CSS classes "show up in the
 *    debugger but don't get calculated". That is what happens with hand-built `innerHTML`
 *    under emulated view encapsulation: the markup never receives the component's scoping
 *    attribute, so scoped styles cannot match it. Template-rendered nodes do.
 *
 * It also removes the `getElementById` + retry-loop dance the old version needed to find
 * its own panel before the view existed.
 */
@Component({
  selector: 'rangertrak-log',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCheckboxModule, MatCardModule, MatButtonModule, PageComponent],
  templateUrl: './log.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./log.component.scss']
})
export class LogComponent {

  private id = 'Log Component'
  title = 'Event Summary Log'
  pageDescr = `Program internal debug information`

  private logPanel = viewChild<ElementRef<HTMLElement>>('logPanel')

  // Which levels to display. Signals rather than plain fields so the computed view below
  // recalculates - this app runs zoneless, where a plain field mutation would not
  // necessarily refresh anything derived from it.
  public excessive = signal(false)
  public verbose = signal(true)
  public info = signal(true)
  public warn = signal(true)
  public error = signal(true)

  /** Display filter only. Entries are already captured (or not) by
   *  LogService.minCaptureLevel; unchecking a box here hides history, never deletes it. */
  public visibleEntries = computed(() => {
    const show = {
      [LogLevel.Excessive]: this.excessive(),
      [LogLevel.Verbose]: this.verbose(),
      [LogLevel.Info]: this.info(),
      [LogLevel.Warn]: this.warn(),
      [LogLevel.Error]: this.error(),
    }
    return this.logService.entries().filter(e => show[e.level] ?? true)
  })

  public totalEntries = computed(() => this.logService.entries().length)

  constructor(private logService: LogService) {
    // Keep the newest entry in view, as the old implementation did. Deferred a tick so the
    // rows for the entries we just reacted to actually exist before measuring scrollHeight.
    effect(() => {
      this.visibleEntries()
      setTimeout(() => {
        const panel = this.logPanel()?.nativeElement
        if (panel) {
          panel.scrollTop = panel.scrollHeight
        }
      })
    })
  }

  /** Maps a level to its stylesheet class. */
  cssClassFor(level: LogLevel): string {
    switch (level) {
      case LogLevel.Excessive: return 'excessive'
      case LogLevel.Verbose: return 'verbose'
      case LogLevel.Info: return 'info'
      case LogLevel.Warn: return 'warn'
      case LogLevel.Error: return 'error'
      default: return 'error'
    }
  }

  trackEntry(_index: number, entry: LogType) {
    return entry.id
  }

  /**
   * Downloads the whole log as CSV.
   *
   * Confirms first, because the log is not sanitized: it contains whatever was logged,
   * which includes serialized radio log entries, resolved street addresses and call signs.
   * Same treatment as the roster export on the Rangers page.
   *
   * FUTURE: offer "full log" and "redacted log" exports, the latter stripping personal
   * detail so a log can be shared for anonymized analysis or replayed during a hot wash.
   */
  onBtnSaveLog() {
    if (!Utility.getConfirmation(
      `Save the event log to a file?\n\n`
      + `The log is a raw diagnostic record and MAY CONTAIN CONFIDENTIAL INFORMATION - `
      + `radio log entry details, street addresses and call signs among them - and is NOT `
      + `encrypted.\n\n`
      + `Share it only with people who need it to diagnose a problem, and delete it `
      + `afterwards.`)) {
      this.logService.verbose('onBtnSaveLog: user cancelled export.', this.id)
      return
    }

    const dt = new Date()
    const stamp = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      + `_${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}`
    const fileName = `RangerTrak.log.${stamp}.csv`

    const blob = new Blob([this.logService.toCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)

    this.logService.info(`Exported ${this.totalEntries()} log entries to ${fileName}`, this.id)
  }

  onBtnClearLog() {
    if (!Utility.getConfirmation('Clear all log entries currently held in memory?')) {
      return
    }
    this.logService.clear()
  }

  /**
   * F29-29: Help used to say "export the log and attach it to your report" - not actually
   * possible, since the in-app feedback form (ADR D-15) is plain text with no file-attach
   * capability. Copying to the clipboard instead lets a scribe paste the log straight into
   * that form (or a GitHub issue) in one step. Same `navigator.clipboard.writeText()` idiom
   * the coordinate rows and the two Leaflet maps already use for their own click-to-copy.
   */
  copied = signal(false)

  onBtnCopyLog() {
    navigator.clipboard.writeText(this.logService.toCsv())
      .then(() => {
        this.copied.set(true)
        setTimeout(() => this.copied.set(false), 2000)
        this.logService.info(`Copied ${this.totalEntries()} log entries to the clipboard.`, this.id)
      })
      .catch(err => {
        this.logService.error(`Log NOT copied to clipboard, error: ${err}`, this.id)
      })
  }
}
