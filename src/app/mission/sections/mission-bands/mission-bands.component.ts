import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { addBand } from '../../../domain/band'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/**
 * E-327: the bands or modes Entry offers for an entry's optional Band (VHF, UHF, D-STAR ...). The parent owns the
 * list; this emits the new one (`itemsChange`), the same pattern as MissionEocCallsComponent. A band is kept as
 * typed (not upper-cased: "Data", "2 m"), and one already listed, in any case, is ignored. Removing a band never
 * changes entries already logged with it. Not a secret: it travels in Setup files and backups.
 */
@Component({
  selector: 'rangertrak-mission-bands',
  standalone: true,
  imports: [MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatButtonModule, AdvancedDirective],
  template: `
<mat-card appearance="outlined" class="rt-mission-card" [rtAdvanced]="'band'">
  <mat-card-header>
    <mat-card-title>Bands</mat-card-title>
    <mat-card-subtitle>Entry can note the band or mode each call came in on. Never required; the net summary
      counts by band. Type a band and press Enter.</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <mat-form-field class="mission__band-field" floatLabel="always">
      <mat-label>Bands and modes</mat-label>
      <mat-chip-grid #grid aria-label="Bands and modes">
        @for (b of items; track b) {
        <mat-chip-row (removed)="remove(b)" [attr.data-testid]="'missionBand'">
          {{ b }}
          <button matChipRemove type="button" [attr.aria-label]="'Remove ' + b"><mat-icon>cancel</mat-icon></button>
        </mat-chip-row>
        }
        <input placeholder="e.g. GMRS" [matChipInputFor]="grid" (matChipInputTokenEnd)="add($event)"
          [matChipInputAddOnBlur]="true" data-lpignore="true" spellcheck="false" data-testid="missionBandInput" />
      </mat-chip-grid>
    </mat-form-field>
  </mat-card-content>
</mat-card>`,
  styles: [`:host { display: contents; } .mission__band-field { width: 100%; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionBandsComponent {
  @Input({ required: true }) items: string[] = []
  @Output() itemsChange = new EventEmitter<string[]>()

  add(event: MatChipInputEvent): void {
    const next = addBand(this.items, event.value ?? '')
    event.chipInput.clear()
    if (next.length !== this.items.length) this.itemsChange.emit(next)
  }

  remove(band: string): void {
    this.itemsChange.emit(this.items.filter(b => b !== band))
  }
}
