import { themeQuartz } from 'ag-grid-community'

/**
 * The one seam a future grid-library swap or re-skin touches. Every param is a
 * `var(--rt-*)` reference into styles/_tokens.scss, never a hex value - see
 * theme-token-layer memory. This needs none of AG Grid's own dark-mode machinery
 * (colorSchemeDark, colorSchemeVariable, ...) because --rt-* already resolves per
 * color-scheme via light-dark() at the CSS level; AG Grid just inherits whatever the
 * browser resolves.
 *
 * Replaces the classic ag-theme-alpine.css path (Sprint F) - see styles.scss and the
 * three grid components (Radio Log entries, Rangers, Settings field-report statuses).
 */
export const rangertrakGridTheme = themeQuartz.withParams({
  // Without this, AG Grid defaults browserColorScheme to 'light' and sets
  // `color-scheme: light` on its own root element - which overrides the `light dark`
  // inherited from :root (styles/_tokens.scss) and pins every light-dark() token
  // below to its light branch regardless of the actual scheme. 'inherit' lets AG
  // Grid's wrapper pick up the app's own color-scheme instead of forcing one.
  browserColorScheme: 'inherit',
  accentColor: 'var(--rt-accent)',
  backgroundColor: 'var(--rt-surface)',
  foregroundColor: 'var(--rt-ink)',
  textColor: 'var(--rt-ink)',
  subtleTextColor: 'var(--rt-ink-2)',
  borderColor: 'var(--rt-line)',
  chromeBackgroundColor: 'var(--rt-surface-2)',
  headerBackgroundColor: 'var(--rt-surface-2)',
  headerTextColor: 'var(--rt-ink)',
  borderRadius: 'var(--rt-radius)',
  wrapperBorderRadius: 'var(--rt-radius-lg)',
  fontFamily: 'inherit',
})
