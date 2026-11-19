import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/**
 * E-324: the call signs of the EOC and other fixed stations. A call from one of these shows blue with an "EOC"
 * tag on Entry and in the Radio Log. The parent owns the list; this emits the new one (`itemsChange`), the same
 * pattern as MissionTacticalCallsComponent. Calls are upper-cased on add and a duplicate is ignored.
 * Not a secret: it travels in Setup files and backups with the rest of the mission settings.
 */
@Component({
  selector: 'rangertrak-mission-eoc-calls',
  standalone: true,
  imports: [MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatButtonModule, AdvancedDirective],
  template: `
<mat-card appearance="outlined" class="rt-mission-card" [rtAdvanced]="'tactical-calls'">
  <mat-card-header>
    <mat-card-title>EOC and station call signs</mat-card-title>
    <mat-card-subtitle>Calls from these show blue with EOC, so the log shows at a glance who is the EOC.
      Type a call sign and press Enter.</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <mat-form-field class="mission__eoc-field" floatLabel="always">
      <mat-label>EOC call signs</mat-label>
      <mat-chip-grid #grid aria-label="EOC and station call signs">
        @for (c of items; track c) {
        <mat-chip-row (removed)="remove(c)" [attr.data-testid]="'eocCall'">
          {{ c }}
          <button matChipRemove type="button" [attr.aria-label]="'Remove ' + c"><mat-icon>cancel</mat-icon></button>
        </mat-chip-row>
        }
        <input placeholder="e.g. W7ABC" [matChipInputFor]="grid" (matChipInputTokenEnd)="add($event)"
          [matChipInputAddOnBlur]="true" data-lpignore="true" spellcheck="false" data-testid="eocCallInput" />
      </mat-chip-grid>
    </mat-form-field>
  </mat-card-content>
</mat-card>`,
  styles: [`:host { display: contents; } .mission__eoc-field { width: 100%; }`],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionEocCallsComponent {
  @Input({ required: true }) items: string[] = []
  @Output() itemsChange = new EventEmitter<string[]>()

  add(event: MatChipInputEvent): void {
    const call = (event.value ?? '').trim().toUpperCase()
    event.chipInput.clear()
    if (!call || this.items.includes(call)) return
    this.itemsChange.emit([...this.items, call])
  }

  remove(call: string): void {
    this.itemsChange.emit(this.items.filter(c => c !== call))
  }
}
