import { Component, ChangeDetectionStrategy, inject } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'

import { PageComponent } from '../shared/page/page.component'
import { HelpSearchComponent } from '../shared/guide/help-search.component'
import { guessRoutes, pathWords } from '../domain/route-guess'

/**
 * E-256 (John 10-28): the only "not found" anyone sees, since the SPA fallback answers every
 * unknown path. It used to be a red box and a Vimeo embed the CSP blocked (and 1024 px wide);
 * now it guesses where the reader meant to go, offers the Help search with the address's own
 * words, and says it in one radio line. All offline, no embeds.
 */
@Component({
  selector: 'rangertrak-x404',
  standalone: true,
  imports: [PageComponent, RouterLink, MatButtonModule, HelpSearchComponent],
  templateUrl: './x404.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./x404.component.scss']
})
export class X404Component {
  title = 'Page not found'
  pageDescr = 'Unknown page'

  readonly path: string
  readonly guesses
  readonly searchFor: string

  constructor() {
    this.path = inject(Router).url.split('?')[0].split('#')[0]
    this.guesses = guessRoutes(this.path)
    this.searchFor = pathWords(this.path).join(' ')
  }
}
