import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { basicEntryTime } from '../../domain/entry-layout'
import { EntryQuickSaveService } from './entry-quick-save.service'
import { EntryRecentListComponent } from './entry-recent-list.component'

/**
 * E-332: the "Basic log (ICS-309)" Entry layout: one blank row at the top (Time, From, To, Message), the newest
 * saved entries below it. Tab moves Time, From, To, Message; Enter saves and returns to From. Time blank = now.
 * Saves through EntryQuickSaveService, the same RadioLogService call the full form ends in.
 */
@Component({
  selector: 'rangertrak-entry-log-grid',
  standalone: true,
  imports: [MatButtonModule, EntryRecentListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entry-log-grid.component.html',
  styleUrl: './entry-log-grid.component.scss',
})
export class EntryLogGridComponent {
  protected readonly quick = inject(EntryQuickSaveService)
  readonly time = signal('')
  readonly from = signal('')
  readonly to = signal('')
  readonly message = signal('')
  readonly savedNote = signal('')
  private readonly fromBox = viewChild<ElementRef<HTMLInputElement>>('fromBox')

  save(): void {
    if (!this.from().trim() && !this.to().trim() && !this.message().trim()) return
    const e = this.quick.save({
      from: this.from(), to: this.to(), message: this.message().trim(),
      date: basicEntryTime(this.time(), new Date()),
    })
    this.savedNote.set(`Entry id # ${e.id} saved`)
    this.time.set('')
    this.from.set('')
    this.to.set('')
    this.message.set('')
    this.fromBox()?.nativeElement.focus()
  }
}
