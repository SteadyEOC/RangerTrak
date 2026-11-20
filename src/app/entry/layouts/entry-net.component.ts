import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import type { CallerResult } from '../../domain/caller-kind'
import { NetDirection, netEntryParties, netMessage, netPartiesLine, sendingAsOptions } from '../../domain/entry-layout'
import type { LocationType } from '../../shared/services/'
import { LocationComponent } from '../location.component'
import { EntryQuickSaveService } from './entry-quick-save.service'
import { EntryRecentListComponent } from './entry-recent-list.component'

/**
 * E-332: the "Net or radio room" Entry layout. One line per call: call sign, In/Out, message (blank = Check-in),
 * Save. Enter saves from any box. Saves through EntryQuickSaveService, the same RadioLogService call the full form ends in.
 */
@Component({
  selector: 'rangertrak-entry-net',
  standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, LocationComponent, EntryRecentListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entry-net.component.html',
  styleUrl: './entry-net.component.scss',
})
export class EntryNetComponent implements OnDestroy {
  protected readonly quick = inject(EntryQuickSaveService)

  readonly call = signal('')
  readonly direction = signal<NetDirection>('in')
  readonly message = signal('')
  readonly hint = signal<CallerResult | null>(null)
  readonly showLocation = signal(false)
  readonly location = signal<LocationType | null>(null)
  readonly savedNote = signal('')

  /** "Sending as" choices; the first (the mission's station call, else the operator's, ...) is the default. */
  readonly sendingOptions = computed(() =>
    sendingAsOptions(this.quick.stationCall(), this.quick.operatorCall(), this.quick.tacticalNames()))
  readonly effectiveSendingAs = computed(() => this.quick.sendingAs().trim() || this.sendingOptions()[0] || '')
  readonly parties = computed(() => netEntryParties(this.call(), this.direction(), this.effectiveSendingAs()))
  readonly partiesLine = computed(() => netPartiesLine(this.parties()))
  readonly missionName = computed(() => this.quick.mission()?.mission ?? '')

  private hintTimer: ReturnType<typeof setTimeout> | undefined

  onCall(value: string): void {
    this.call.set(value)
    clearTimeout(this.hintTimer)
    this.hintTimer = setTimeout(async () => {
      const h = await this.quick.hint(value)
      if (this.call() === value) this.hint.set(h)
    }, 300)
  }

  /** Opens the location box at the mission's default position, as the full form starts. */
  addLocation(): void {
    this.location.set(this.quick.defaultLocation())
    this.showLocation.set(true)
  }

  /** The location to save: none when the box is closed or still at the mission default, as on the full form. */
  private locationToSave(): LocationType | null {
    const loc = this.showLocation() ? this.location() : null
    if (!loc) return null
    const def = this.quick.defaultLocation()
    return loc.lat === def.lat && loc.lng === def.lng ? null : loc
  }

  save(): void {
    if (!this.call().trim() && !this.message().trim()) return
    const { from, to } = this.parties()
    const loc = this.locationToSave()
    const e = this.quick.save({
      from, to, message: netMessage(this.message()), band: this.quick.band(), ...(loc ? { location: loc } : {}),
    })
    this.savedNote.set(`Entry id # ${e.id} saved`)
    this.call.set('')
    this.message.set('')
    this.hint.set(null)
    this.showLocation.set(false)
    this.location.set(null)
    // Direction, Sending as and Band (E-327) stay as they were, like the operator, for the next call.
    document.getElementById('entry-net-call')?.focus()
  }

  ngOnDestroy(): void { clearTimeout(this.hintTimer) }
}
