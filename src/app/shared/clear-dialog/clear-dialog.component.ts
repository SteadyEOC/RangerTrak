import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'

import { applyTick, chosenIds, countText, photosFollowRoster } from '../../domain/clear-choices'
import type { ClearContext, ClearId, ClearRow } from '../../domain/clear-choices'

export type ClearDialogData = {
  title: string
  confirmLabel: string
  context: ClearContext
  rows: readonly ClearRow[]
  /** `AttachmentStoreService.deletionNotice([])` text ('' when there are no attachments). */
  attachmentNote: string
  /** True while the app thinks the mission is in use: the dialog then asks for the mission name. */
  live: boolean
  missionName: string
}

/** Closes with the ids to clear, or null on Cancel (or Back up first). */
export type ClearDialogResult = ReadonlySet<ClearId> | null

/**
 * E-221 "What to clear": one dialog for every action that replaces or empties the mission (Load a
 * demo, Start a real mission, leaving Demo, Clear radio log). Locked rows are what the action always
 * removes; the rest are the operator's choice. In a live mission it also carries E-168's guard: Back
 * up first, and the mission name (or REPLACE) typed before the confirm button turns on. Nothing here
 * changes data; the caller does, from the ids it gets back. The rules for the rows are in
 * domain/clear-choices.ts.
 */
@Component({
  selector: 'rangertrak-clear-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <h2 mat-dialog-title data-testid="clear-title">{{ data.title }}</h2>
    <mat-dialog-content>
      @if (locked().length) {
        <h3 class="cd__head">{{ data.context === 'replace' ? 'Replaced (can\\'t be kept)' : 'Deleted' }}</h3>
        @if (narrow() && !expanded()) {
          <button matButton type="button" class="cd__collapsed" data-testid="clear-locked-toggle" (click)="expanded.set(true)">
            <mat-icon>lock</mat-icon> {{ data.context === 'next' ? 'Clears the radio log and the mission name' : 'Replaces roster, photos, log, locations and settings' }}
          </button>
        } @else {
          <ul class="cd__list" data-testid="clear-locked">
            @for (row of locked(); track row.id) {
              <li class="cd__row">
                <mat-icon class="cd__lock" aria-label="Cannot be kept">lock</mat-icon>
                <span class="cd__label">{{ row.label }}</span>
                <span class="cd__count">{{ text(row) }}</span>
              </li>
              @if (row.id === 'log' && data.attachmentNote) {
                <li class="cd__note" data-testid="clear-attachments">{{ data.attachmentNote.trim() }}</li>
              }
            }
          </ul>
        }
      }

      @if (incident().length) {
        <h3 class="cd__head">{{ data.context === 'next' ? 'Also clear, if you choose' : 'From the current incident' }}</h3>
        <ul class="cd__list">
          @for (row of incident(); track row.id) {
            <li class="cd__row">
              <mat-checkbox [checked]="ticked().has(row.id)" [disabled]="row.id === 'photos' && photosFixed()"
                (change)="onTick(row.id, $event.checked)" [attr.data-testid]="'clear-' + row.id">
                <span class="cd__label">{{ row.label }}</span>
              </mat-checkbox>
              <span class="cd__count">{{ text(row) }}</span>
            </li>
          }
        </ul>
      }

      @if (app().length) {
        <h3 class="cd__head">Kept unless you choose</h3>
        <ul class="cd__list">
          @for (row of app(); track row.id) {
            <li class="cd__row">
              <mat-checkbox [checked]="ticked().has(row.id)" (change)="onTick(row.id, $event.checked)" [attr.data-testid]="'clear-' + row.id">
                <span class="cd__label">{{ row.label }}</span>
              </mat-checkbox>
              <span class="cd__count">{{ text(row) }}</span>
            </li>
          }
        </ul>
      }

      <p class="cd__note">
        @if (data.context === 'replace') { Always kept: offline maps, device settings, view. }
        @else if (data.context === 'next') { Always kept: offline maps, device settings, view, and the other mission settings (map, formats, statuses). }
        @else { Everything else on this device is kept. }
      </p>
      @if (unticked().length) {
        <p class="cd__warn" data-testid="clear-unticked">
          <mat-icon>warning</mat-icon>
          @if (data.context === 'replace') { Unchecked items stay and show alongside the new data. }
          @else if (data.context === 'next') { Unchecked items stay for the next mission. }
          @else { Unchecked items stay. }
        </p>
      }

      @if (data.live) {
        <p class="cd__warn" role="alert" data-testid="clear-live">
          <mat-icon>warning</mat-icon> This mission looks like it is in use right now. Back it up first if you may need it.
        </p>
      }
      <button matButton="outlined" type="button" data-testid="clear-backup" (click)="onBackUp()">
        <mat-icon>download</mat-icon> Back up mission first
      </button>

      @if (data.live) {
        <mat-form-field class="cd__type" appearance="outline">
          <mat-label>To go ahead, type {{ word() }}</mat-label>
          <input matInput type="text" autocomplete="off" data-testid="clear-type" (input)="typed.set($any($event.target).value)" />
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" cdkFocusInitial data-testid="clear-cancel" [mat-dialog-close]="null">Cancel</button>
      <button matButton="filled" type="button" data-testid="clear-confirm" [disabled]="!canConfirm()" (click)="onConfirm()">
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .cd__head { margin: 0.75rem 0 0.25rem; font-size: 1rem; }
    .cd__list { list-style: none; margin: 0 0 0.5rem; padding: 0; }
    .cd__row { display: flex; align-items: center; gap: 0.5rem; padding: 0.125rem 0; }
    .cd__label { overflow-wrap: anywhere; }
    .cd__count { margin-left: auto; color: var(--rt-ink-2); white-space: nowrap; }
    .cd__lock { flex: none; color: var(--rt-ink-2); }
    .cd__note { margin: 0.25rem 0 0.75rem; color: var(--rt-ink-2); }
    .cd__warn { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.75rem; color: var(--rt-readiness-red); }
    .cd__collapsed { margin-bottom: 0.5rem; white-space: normal; text-align: left; }
    .cd__type { display: block; margin-top: 1rem; }
  `],
})
export class ClearDialogComponent {
  protected data = inject<ClearDialogData>(MAT_DIALOG_DATA)
  private ref = inject<MatDialogRef<ClearDialogComponent, ClearDialogResult>>(MatDialogRef)
  private router = inject(Router)

  protected readonly locked = computed(() => this.data.rows.filter(r => r.locked))
  protected readonly incident = computed(() => this.data.rows.filter(r => !r.locked && r.id !== 'appNotes'))
  protected readonly app = computed(() => this.data.rows.filter(r => r.id === 'appNotes'))

  protected readonly ticked = signal<ReadonlySet<ClearId>>(new Set(this.data.rows.filter(r => r.checked).map(r => r.id)))
  /** E-319: ticking Roster ticks and locks Photos (photos are keyed by call sign). */
  protected readonly photosFixed = computed(() => photosFollowRoster(this.data.context, this.ticked()))
  protected readonly unticked = computed(() => this.data.rows.filter(r => !r.locked && !this.ticked().has(r.id)))

  /** Under 600 px the locked block is one line until tapped. */
  protected readonly narrow = signal(window.matchMedia('(max-width: 599.98px)').matches)
  protected readonly expanded = signal(false)

  protected readonly typed = signal('')
  protected readonly word = computed(() => this.data.missionName.trim() || 'REPLACE')
  protected readonly canConfirm = computed(() => {
    if (!this.data.live) return true
    const t = this.typed().trim().toLowerCase()
    return t !== '' && (t === this.word().toLowerCase() || t === 'replace')
  })

  protected text(row: ClearRow): string { return countText(row.id, row.count) }

  protected onTick(id: ClearId, on: boolean): void {
    this.ticked.set(applyTick(this.ticked(), id, on, this.data.context))
  }

  /** Stops here (nothing changed) and takes the operator to the Mission page's backup. */
  protected onBackUp(): void {
    this.ref.close(null)
    void this.router.navigate(['/mission'])
  }

  protected onConfirm(): void {
    if (this.canConfirm()) this.ref.close(chosenIds(this.data.rows, this.ticked()))
  }
}
