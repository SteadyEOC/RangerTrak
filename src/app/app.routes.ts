import { Routes } from '@angular/router'

import { EntryComponent } from './entry/entry.component'
import { unsavedChangesGuard } from './shared/guards/unsaved-changes.guard'
import { fieldModeGuard } from './shared/guards/field-mode.guard'

// https://angular.io/guide/router
// https://angular.io/api/router/Resolve#usage-notes - Processing order: BaseGuard, ChildGuard, BaseDataResolver, ChildDataResolver

/**
 * Only the Entry page (the landing route, and the screen an operator spends a mission in)
 * is eager. Everything else is a `loadComponent` split point.
 *
 * Every route used to be eager, which meant the initial bundle carried AG Grid, xlsx,
 * MapLibre and the full map/grid page code before the first screen could render - most of
 * it for pages a given user might never open. The heavy libraries now land in the chunk of
 * the route that actually uses them: AG Grid + xlsx with Reports/Rangers/Settings/Log,
 * Leaflet with `/map`.
 *
 * Note this trades *initial* download, not total - or did, until 2026-09-01: app.config.ts
 * now registers withPreloading(NoPreloading), a control experiment after PreloadAllModules
 * AND a `requestIdleCallback`/`window.load`-gated replacement (idle-preloading-strategy.ts,
 * still in the tree, unused) were BOTH shipped and independently verified live to not fix a
 * real PageSpeed CLS/LCP regression this caused. See app.config.ts's own comment for the
 * full reasoning - the short version is that on a throttled device, no "wait until idle"
 * heuristic can dodge landing preload work in the same window the LCP element still needs.
 * Offline completeness never actually depended on router-level preloading regardless -
 * ngsw-config.json's "app" asset group prefetches every `/*.js` file unconditionally on
 * service-worker install, independent of the router entirely. What IS lost with
 * `NoPreloading`: snappy in-mission navigation (Map -> Radio Log -> Rangers used to warm
 * instantly; now each is a real JS-parse stall on first visit) - an accepted, known
 * regression while this is being sorted out, not an oversight.
 *
 * E-64 exception: MapLibre is NOT preloaded with `/map`, even though Leaflet is. It sits
 * behind a plain `import()` call inside MapPageComponent's engine-switch handler rather
 * than a second `loadComponent` route, and any Routes-table preloading strategy only walks
 * the table above - it has no way to see (or preload) a dynamic import buried inside a
 * component method. A visitor who never flips the switch never fetches it, full session or not.
 */
export const APP_ROUTES: Routes = [
  // EAGER: the landing page, so it must not be a separate round trip.
  // 2026-10-05: a title per page (Angular's default TitleStrategy sets document.title), now that
  // search engines may index / and /help (robots.txt) - one shared title made every result look
  // identical. Printing still overrides it on beforeprint (shared print-title helper).
  { path: '', component: EntryComponent, title: 'RangerTrak - radio log and ranger tracking, offline' },

  // LAZY: loaded on first navigation (and preloaded in the background - see above).
  // 2026-08-27: was 'reports' - renamed to match the page's new "Radio Log" nav label/title
  // (same "URL matches nav label" convention 'settings'->'mission' and 'about'->'help'
  // already followed). Redirect below covers old bookmarks.
  // E-114 §1a (2026-08-31): every route below except Home ('') and Help is a command-post/
  // scribe concern, hidden from field-mode devices - navbar.component.html hides the link,
  // fieldModeGuard (shared/guards/field-mode.guard.ts) closes the typed-URL/bookmark/pinned-
  // shortcut gap that hiding a link alone leaves open.
  {
    path: 'radio-log',
    title: 'Radio Log - RangerTrak',
    loadComponent: () => import('./radio-log/radio-log.component').then(m => m.RadioLogComponent),
    canActivate: [fieldModeGuard],
  },
  // New 2026-08-27: ICS-213 messages (radio log entries with generates213 set), list + detail
  // view rather than a second grid - see the roadmap's ICS-309/213 scoping note.
  {
    path: 'messages',
    title: 'Messages - RangerTrak',
    loadComponent: () => import('./messages/messages.component').then(m => m.MessagesComponent),
    canActivate: [fieldModeGuard],
  },
  // E-64: one route for both engines - MapPageComponent is a thin shell that mounts
  // Leaflet by default and dynamically imports MapLibre only if the on-page switch is
  // flipped, so a visitor who never touches the switch never downloads its ~966KB chunk.
  // `/mapLeaflet` is gone outright (no redirect - see the roadmap's E-64 decisions: existing PWA
  // installs pointing at it are a discounted, power-user-only edge case).
  {
    path: 'map',
    title: 'Map - RangerTrak',
    loadComponent: () => import('./map/map-page/map-page.component').then(m => m.MapPageComponent),
    canActivate: [fieldModeGuard],
  },
  {
    path: 'rangers',
    title: 'Rangers - RangerTrak',
    loadComponent: () => import('./rangers/rangers.component').then(m => m.RangersComponent),
    canActivate: [fieldModeGuard],
  },
  // 2026-08-22: was 'settings' - every URL now matches its nav label ("Mission"), not
  // the older, more generic route name. Kept as a redirect below rather than a hard
  // break, since this route predates that rename and may be bookmarked.
  {
    path: 'mission',
    title: 'Mission - RangerTrak',
    loadComponent: () => import('./mission/mission.component').then(m => m.MissionComponent),
    // F29-23 (2026-08-30): warns before navigating away with unsaved Mission edits - the
    // shared guard (src/app/shared/guards/unsaved-changes.guard.ts) only needs the target
    // component to implement HasUnsavedChanges, so any future manual-Save page adopts this
    // the same way, not by rebuilding the guard.
    canDeactivate: [unsavedChangesGuard],
    canActivate: [fieldModeGuard],
  },
  // E-116: no fieldModeGuard - a field-mode phone captures notes from the header too.
  {
    path: 'after-action',
    title: 'AAR notes - RangerTrak',
    loadComponent: () => import('./after-action/after-action.component').then(m => m.AfterActionComponent),
  },
  {
    path: 'log',
    title: 'Log - RangerTrak',
    loadComponent: () => import('./log/log.component').then(m => m.LogComponent),
    canActivate: [fieldModeGuard],
  },
  // E-109 Setup files v2 (2026-08-31, ADR D-48): a pre-mission provisioning tool,
  // deliberately its own route rather than folded into Rangers' own roster import/export -
  // see prep.component.ts's own doc comment. No main-nav entry (same choice the Log route
  // already made) - linked from Rangers' roster-management controls instead.
  {
    path: 'prep',
    title: 'Prep - RangerTrak',
    loadComponent: () => import('./prep/prep.component').then(m => m.PrepComponent),
    canActivate: [fieldModeGuard],
  },

  // LAZY child routes (via dynamic import)
  // 2026-08-22: was 'about' - the nav item and page heading were renamed "About" ->
  // "Help" (E-57(1)) but the URL never followed; redirect below covers old bookmarks.
  {
    path: 'help',
    title: 'Help - RangerTrak',
    loadChildren: () => import('./lazy/lazy.routes').then(m => m.LAZY_ROUTES)
  },

  // Redirects for the renames above - old bookmarks/links keep working.
  { path: 'settings', redirectTo: 'mission' },
  { path: 'about', redirectTo: 'help' },
  { path: 'reports', redirectTo: 'radio-log' },
  // 2026-10-05: tester hit a 404 on /entry (the Radio Log's links pointed there; Entry is the
  // root route). Links fixed; this keeps typed or bookmarked /entry URLs working too.
  { path: 'entry', redirectTo: '' },

  // Page not found route
  {
    path: '**',
    loadComponent: () => import('./x404/x404.component').then(m => m.X404Component)
  }
]
