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
 * The coordinate line states what the map's numbers are: latitude/longitude on the WGS84
 * datum, in decimal degrees by default. The Leaflet map passes `coordNote` to name the
 * format its printed edge ticks use (2026-09-30).
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
      <div class="furniture__coords">{{ coordNote() }}</div>
    </div>
  `,
  styles: [`
    :host { display: none; }

    @media print {
      :host {
        display : block;
        position: absolute;
        top     : 1.5mm;
        right   : 1.5mm;
        /* Above Leaflet's panes and controls (up to 1000), which are not in a stacking
           context of their own. */
        z-index : 1200;
      }

      /* 2026-09-30, John: "Make compass rose not in a box. Just add shadow or glow to it so
         it stands out. Text goes to edge of map if really needed." No box: a white glow
         behind the arrow and a white halo round the note keep both readable over any map. */
      .furniture {
        display       : flex;
        flex-direction: column;
        align-items   : flex-end;
        color         : #000;
        -webkit-print-color-adjust: exact;
        print-color-adjust        : exact;
      }

      .furniture__north {
        display    : block;
        margin-right: 6mm;
        filter     : drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 3px #fff) drop-shadow(0 0 5px #fff);
      }

      .furniture__coords {
        max-width  : 60mm;
        margin-top : 0.5mm;
        font-size  : 7pt;
        font-weight: 600;
        line-height: 1.2;
        text-align : right;
        text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 4px #fff, 0 0 6px #fff;
      }
    }
  `],
})
export class MapPrintFurnitureComponent {
  /** Map rotation in degrees clockwise from north-up (MapLibre's getBearing()). */
  bearing = input(0)
  /** What the map's coordinates are written in. Leaflet passes its edge-tick format. */
  coordNote = input('Latitude / longitude, decimal degrees, WGS84')
}
