import { Injectable, signal } from "@angular/core"

import { LogService } from "./log.service"

export type Skin = 'ridgeline' | 'command' | 'nightwatch' | 'sagebrush' | 'signal'

const SKIN_KEY = 'skinChoice'

// Must match the inline bootstrap script in index.html, which reads this same key before
// Angular loads so a saved skin applies on first paint instead of flashing the default
// (command) skin first - same reasoning as ThemeService/THEME_MODE_KEY.
export const SKINS: { value: Skin; label: string; accent: string }[] = [
  { value: 'ridgeline', label: 'Ridgeline', accent: '#9A3412' },
  { value: 'command', label: 'Command', accent: '#0B5FA8' },
  { value: 'nightwatch', label: 'Nightwatch', accent: '#0F6E63' },
  { value: 'sagebrush', label: 'Sagebrush', accent: '#4F6B14' },
  { value: 'signal', label: 'Signal', accent: '#9A5B00' },
]

function isSkin(value: string | null): value is Skin {
  return value === 'ridgeline' || value === 'command' || value === 'nightwatch'
    || value === 'sagebrush' || value === 'signal'
}

/**
 * Owns the user's color-scheme (skin) choice. 2026-08-26: the skins in
 * styles/_chrome.scss (and their generated M3 palettes in styles/skins/) used to be a
 * single compile-time choice - styles/_active-skin.scss, one line to edit and rebuild. This
 * is that made runtime: every RangerTrak token (styles/_tokens.scss) and every Material
 * component token (styles.scss's scoped mat.theme() calls) is now defined for all five
 * skins at once (Sagebrush and Signal added same day, completing the redesign canvas's own
 * five-scheme set), gated on a `data-skin` attribute this service sets on <html>. No
 * attribute (or 'command') is the default - matches both stylesheets' own choice of default,
 * so this service never needs to touch anything for the common case.
 */
@Injectable({ providedIn: 'root' })
export class SkinService {

  private id = 'Skin Service'

  readonly skin = signal<Skin>(this.readStored())

  constructor(private log: LogService) {
    this.apply(this.skin())
  }

  set(skin: Skin): void {
    this.skin.set(skin)
    localStorage.setItem(SKIN_KEY, skin)
    this.apply(skin)
    this.log.verbose(`Skin set to '${skin}'`, this.id)
  }

  /** E-313 / Q97: a read-only window follows the main window's choice live. Reads, applies, never writes. */
  reloadFromStore(): void {
    const skin = this.readStored()
    this.skin.set(skin)
    this.apply(skin)
  }

  private apply(skin: Skin): void {
    if (skin === 'command') {
      // command IS the unmarked default in both styles.scss and _tokens.scss - removing
      // the attribute rather than setting it to 'command' keeps the DOM state consistent
      // with what an all-new visitor (nothing in localStorage) already looks like.
      document.documentElement.removeAttribute('data-skin')
    } else {
      document.documentElement.setAttribute('data-skin', skin)
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', SKINS.find(s => s.value === skin)?.accent ?? '#0B5FA8')
    }
  }

  private readStored(): Skin {
    const stored = localStorage.getItem(SKIN_KEY)
    return isSkin(stored) ? stored : 'command'
  }
}
