import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'

import { DisplayService } from '../services/display.service'
import { PopOutSyncService } from '../services/pop-out-sync.service'

/**
 * E-314 / D-71: the one small bar a Display window keeps: "Exit display", and (Q75) "Clear marks"
 * while rows are marked. It fades out after 3 seconds without the mouse, a tap or a key, and comes
 * back on the next one, so a wall screen shows the page and nothing else. Rendered once, in the
 * app shell, only while Display is on. Fixed, with a four-digit z-index so it sits above the map.
 *
 * E-313: in a read-only window (a pop-out) "Exit display" is "Close window", and a "Read-only" label
 * sits at the bottom left for good (it does not fade; it is the cue, with the coloured frame round the
 * window, that this one only looks). When the main RangerTrak window has been closed it also says
 * "Not updating", since the window is then showing what it last saw.
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
    @if (display.readOnly) {
    <div class="display-status" data-testid="readonly-status">
      <span class="display-status__label" data-testid="readonly-label">Read-only</span>
      @if (!sync.mainWindowOpen()) {
      <span class="display-status__note" data-testid="popout-stale" role="status">Not updating: the main RangerTrak window is closed</span>
      }
    </div>
    }
    <div class="display-bar" [class.display-bar--idle]="idle()" role="toolbar" aria-label="Display"
      data-testid="display-bar" (focusin)="wake()">
      @if (display.markCount() > 0) {
      <button matButton="outlined" type="button" data-testid="display-clear-marks" (click)="display.clearMarks()"
        title="Clear the rows you marked in this window">
        Clear marks ({{ display.markCount() }})
      </button>
      }
      @if (display.readOnly) {
      <button matButton="filled" type="button" data-testid="popout-close" (click)="display.closeWindow()"
        title="Close this window. The main RangerTrak window is not affected.">
        <mat-icon>close</mat-icon>
        Close window
      </button>
      } @else {
      <button matButton="filled" type="button" data-testid="display-exit" (click)="display.exit()"
        title="Leave Display and return to the page as it was (Esc does the same)">
        <mat-icon>close</mat-icon>
        Exit display
      </button>
      }
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
    .display-status {
      position: fixed; bottom: 18px; left: 18px; z-index: 5000;
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 40vw;
    }
    .display-status__label {
      padding: 4px 12px; border-radius: 999px; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.04em;
      background: var(--rt-readonly); color: var(--rt-readonly-ink);
    }
    .display-status__note {
      padding: 4px 12px; border-radius: 999px; font-size: 0.8rem;
      background: var(--rt-surface); color: var(--rt-ink); border: 2px solid var(--rt-readonly);
    }
    .display-bar--idle { opacity: 0; pointer-events: none; }
    .display-bar--idle:focus-within { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .display-bar { transition: none; } }`,
})
export class DisplayBarComponent {
  protected readonly display = inject(DisplayService)
  protected readonly sync = inject(PopOutSyncService)
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
