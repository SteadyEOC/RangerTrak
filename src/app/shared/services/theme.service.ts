import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"

export type ThemeMode = 'auto' | 'light' | 'dark'

// Must match the inline bootstrap script in index.html, which reads this same key
// before Angular loads so a saved override applies on first paint instead of flashing
// the OS-default scheme first.
const THEME_MODE_KEY = 'themeMode'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark'
}

/**
 * Owns the user's light/dark override. Every RangerTrak color token has exactly one
 * definition, via CSS light-dark() (styles/_tokens.scss), driven by the used value of
 * `color-scheme` on the root element - 'auto' leaves that at the stylesheet's `light dark`
 * default (follows the OS/browser), 'light'/'dark' pin it via an inline style on <html>,
 * which wins over the stylesheet rule.
 *
 * A manual override matters here specifically because a scribe's OS theme setting rarely
 * tracks actual field lighting - daylight glare vs. a dim vehicle cab at night - the way it
 * would for a phone used indoors all day.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {

  private id = 'Theme Service'

  readonly mode = signal<ThemeMode>(this.readStored())

  constructor(private log: LogService) {
    this.apply(this.mode())
  }

  /** auto -> light -> dark -> auto, for a single tap/click toggle. */
  cycle(): void {
    const next: Record<ThemeMode, ThemeMode> = { auto: 'light', light: 'dark', dark: 'auto' }
    this.set(next[this.mode()])
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode)
    localStorage.setItem(THEME_MODE_KEY, mode)
    this.apply(mode)
    this.log.verbose(`Theme mode set to '${mode}'`, this.id)
  }

  /** E-313 / Q97: a read-only window follows the main window's choice live. Reads, applies, never writes. */
  reloadFromStore(): void {
    const mode = this.readStored()
    this.mode.set(mode)
    this.apply(mode)
  }

  private apply(mode: ThemeMode): void {
    document.documentElement.style.colorScheme = mode === 'auto' ? '' : mode
  }

  private readStored(): ThemeMode {
    const stored = localStorage.getItem(THEME_MODE_KEY)
    return isThemeMode(stored) ? stored : 'auto'
  }
}
