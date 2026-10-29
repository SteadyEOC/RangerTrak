import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core'
import { Router } from '@angular/router'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'

import type { GuideEntry } from './guide-content'
import type { HelpIndexEntry } from './help-index.generated'
import { GuideService } from './guide.service'
import { HelpHit, searchHelp } from './help-search'

/**
 * E-264: one search box over Help's tabs and every screen's Guide text, used on /help and on
 * the 404 page (E-256). Both sources are fetched on first use, not with the page: the Guide
 * text is its own lazy chunk already (GuideService), and the service worker caches both, so
 * the search works offline once the app has loaded.
 */
@Component({
  selector: 'rangertrak-help-search',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule],
  templateUrl: './help-search.component.html',
  styleUrls: ['./help-search.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpSearchComponent implements OnInit {
  private router = inject(Router)
  private guide = inject(GuideService)

  /** Search for this at once (the 404 page passes the words of the bad address). */
  readonly initialQuery = input('')
  /** How many results to list. */
  readonly limit = input(12)

  readonly query = signal('')
  readonly hits = signal<HelpHit[]>([])
  readonly loadFailed = signal(false)

  private data?: { index: readonly HelpIndexEntry[], guide: Record<string, GuideEntry> }
  private loading?: Promise<void>

  ngOnInit(): void {
    if (this.initialQuery()) {
      this.query.set(this.initialQuery())
      void this.run()
    }
  }

  onInput(value: string): void {
    this.query.set(value)
    void this.run()
  }

  clear(): void {
    this.query.set('')
    this.hits.set([])
  }

  private load(): Promise<void> {
    this.loading ??= Promise.all([import('./help-index.generated'), import('./guide-content')])
      .then(([h, g]) => { this.data = { index: h.HELP_INDEX, guide: g.GUIDE_CONTENT } })
      .catch(() => {
        this.loadFailed.set(true)
        this.loading = undefined
      })
    return this.loading
  }

  private async run(): Promise<void> {
    if (!this.data) await this.load()
    if (!this.data) return
    this.hits.set(searchHelp(this.query(), this.data.index, this.data.guide, this.limit()))
  }

  /** A Help section opens its tab and scrolls to it; a Guide section opens that screen's Guide. */
  async go(hit: HelpHit): Promise<void> {
    this.clear()
    if (hit.helpTab) {
      await this.router.navigate(['/help'], { queryParams: { tab: hit.helpTab }, fragment: hit.anchor })
    } else if (hit.route) {
      await this.router.navigateByUrl(hit.route)
      this.guide.open(hit.guideTab)
    }
  }
}
