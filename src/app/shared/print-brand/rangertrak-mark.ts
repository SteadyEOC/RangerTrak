/**
 * E-280 (John, 2026-11-07): the RangerTrak mark as plain path data, for printouts that cannot load
 * an image file - the PDFs (pdf-lib draws these paths) and the print-brand component (inline SVG, so
 * an offline device still prints the logo; /assets/** is only cached once it has been fetched).
 *
 * Same geometry as src/assets/icons/rangertrak-mark.svg (viewBox 0 0 155 260). The SVG scales its
 * three signal waves with transforms about the antenna tip (52,88); here they are pre-scaled
 * (0.80, 1.30, 1.85) because pdf-lib has no transform on a path. The radio's three white key slots
 * are left out: at print size (about 5 mm tall) they are under a tenth of a millimetre.
 */
export const MARK_VIEWBOX = { width: 155, height: 260 }
export const MARK_NAVY = '#12263F'
export const MARK_SIGNAL = '#F0700A'

/** Pin outline (stroke 12) and antenna (stroke 5), navy, unfilled. */
export const MARK_PIN = 'M 52 239 L 18.4 175.8 A 38 38 0 1 1 85.6 175.8 Z'
export const MARK_ANTENNA = 'M 52 96 L 52 150'
/** Radio body and antenna tip, navy, filled. */
export const MARK_BODY = 'M 50 142 L 54 142 A 6 6 0 0 1 60 148 L 60 194 A 6 6 0 0 1 54 200 L 50 200 A 6 6 0 0 1 44 194 L 44 148 A 6 6 0 0 1 50 142 Z'
export const MARK_TIP = 'M 44 88 A 8 8 0 1 0 60 88 A 8 8 0 1 0 44 88 Z'
/** The three signal waves (stroke 7, round caps), orange. */
export const MARK_WAVES = [
  'M 70.352 61.784 A 32 32 0 0 1 76.512 108.568',
  'M 81.822 45.399 A 52 52 0 0 1 91.832 121.423',
  'M 94.439 27.376 A 74 74 0 0 1 108.684 135.564',
]

/** What the brand line says after the version: the site a reader can look RangerTrak up on. */
export const BRAND_URL = 'https://rangertrak.org'
export const BRAND_URL_LABEL = 'RangerTrak.org'
