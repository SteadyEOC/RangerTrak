import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'

import { DisplayService } from '../services/display.service'

/**
 * E-314 / D-71: the one small bar a Display window keeps: "Exit display", and (Q75) "Clear marks"
 * while rows are marked. It fades out after 3 seconds without the mouse, a tap or a key, and comes
 * back on the next one, so a wall screen shows the page and nothing else. Rendered once, in the
 * app shell, only while Display is on. Fixed, with a four-digit z-index so it sits above the map.
 *
 * 2026-11-15: bottom centre, not top right, so it never covers the mission name and clock that
 * Display keeps in the header's top right. While faded it lets clicks through, so a tap on the
 * invisible bar cannot leave Display by accident.
 */
@Component({
  selector: 'rangertrak-display-bar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (display.active()) {
    <div class="display-bar" [class.display-bar--idle]="idle()" role="toolbar" aria-label="Display"
      data-testid="display-bar" (focusin)="wake()">
      @if (display.markCount() > 0) {
      <button matButton="outlined" type="button" data-testid="display-clear-marks" (click)="display.clearMarks()"
        title="Clear the rows you marked in this window">
        Clear marks ({{ display.markCount() }})
      </button>
      }
      <button matButton="filled" type="button" data-testid="display-exit" (click)="display.exit()"
        title="Leave Display and return to the page as it was (Esc does the same)">
        <mat-icon>close</mat-icon>
        Exit display
      </button>
    </div>
    }`,
  styles: `
    .display-bar {
      position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 5000;
      display: flex; gap: 8px; align-items: center;
      padding: 6px; border-radius: 8px;
      background: var(--rt-surface); box-shadow: 0 2px 10px rgb(0 0 0 / 0.3);
      transition: opacity 0.4s;
    }
    .display-bar--idle { opacity: 0; pointer-events: none; }
    .display-bar--idle:focus-within { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .display-bar { transition: none; } }`,
})
export class DisplayBarComponent {
  protected readonly display = inject(DisplayService)
  protected readonly idle = signal(false)
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    // Entering Display shows the bar for its first 3 seconds.
    effect(() => { if (this.display.active()) { this.idle.set(false); this.arm() } })
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer))
  }

  @HostListener('document:mousemove')
  @HostListener('document:touchstart')
  @HostListener('document:keydown')
  wake(): void {
    if (!this.display.active()) return
    this.idle.set(false)
    this.arm()
  }

  private arm(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.idle.set(true), 3000)
  }
}
