import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/**
 * 2026-09-30, John: E-152 part 1 - the north arrow and the "what do these numbers mean"
 * line that a finished map sheet carries. Print-only (hidden on screen); each map engine
 * places it INSIDE its own map frame so it sits over the corner of the map itself.
 *
 * The scale bar and the base map credit are NOT drawn here: each engine already has its
 * own (Leaflet's L.control.scale and attribution control, MapLibre's ScaleControl and
 * attribution control), and those are what the print CSS keeps visible - a second,
 * hand-written copy here could say something the map does not.
 *
 * The coordinate line states what this app's map actually uses: plain latitude/longitude in
 * decimal degrees on the WGS84 datum (the readout under the map, and the numbers the map
 * copies to the clipboard when clicked).
 */
@Component({
  selector: 'rangertrak-map-print-furniture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="furniture" aria-hidden="true">
      <!-- Degrees the map is turned away from north-up: 0 for Leaflet (which cannot rotate);
           MapLibre passes its live bearing so the arrow never lies about a rotated map. -->
      <svg class="furniture__north" viewBox="0 0 40 56" width="40" height="56"
        [style.transform]="'rotate(' + -bearing() + 'deg)'">
        <polygon points="20,4 32,44 20,36 8,44" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>
        <polygon points="20,4 20,36 8,44" fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="round"/>
        <text x="20" y="54" text-anchor="middle" font-size="13" font-weight="700" font-family="sans-serif" fill="#000">N</text>
      </svg>
      <div class="furniture__coords">Latitude / longitude, decimal degrees, WGS84</div>
    </div>
  `,
  styles: [`
    :host { display: none; }

    @media print {
      :host {
        display : block;
        position: absolute;
        top     : 3mm;
        right   : 3mm;
        /* Above Leaflet's panes and controls (up to 1000), which are not in a stacking
           context of their own. */
        z-index : 1200;
      }

      .furniture {
        display       : flex;
        flex-direction: column;
        align-items   : center;
        padding       : 1.5mm 2mm;
        background    : rgba(255, 255, 255, .85);
        border        : 1px solid #000;
        color         : #000;
        -webkit-print-color-adjust: exact;
        print-color-adjust        : exact;
      }

      .furniture__north {
        display: block;
      }

      .furniture__coords {
        max-width  : 30mm;
        margin-top : 1mm;
        font-size  : 7pt;
        line-height: 1.2;
        text-align : center;
      }
    }
  `],
})
export class MapPrintFurnitureComponent {
  /** Map rotation in degrees clockwise from north-up (MapLibre's getBearing()). */
  bearing = input(0)
}
