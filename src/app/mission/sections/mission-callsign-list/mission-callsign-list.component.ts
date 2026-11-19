import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'

import { CallsignDirectoryService } from '../../../shared/services/callsign-directory.service'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/**
 * E-325: the "Call sign list" card. The list is an offline copy of the public ISED (Canada) or FCC (US) amateur
 * licence data that the person downloads and picks here; the app never downloads it (D-10). It lives on this
 * device only, and is not in backups, Setup files or hand-overs. The parser is lazy-loaded by the service.
 */
@Component({
  selector: 'rangertrak-mission-callsign-list',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, AdvancedDirective],
  templateUrl: './mission-callsign-list.component.html',
  styles: [`:host { display: contents; } .mission__callsign-region { width: 100%; } .mission__callsign-links { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0 0 1rem; }`],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionCallsignListComponent {
  protected readonly directory = inject(CallsignDirectoryService)

  protected readonly region = signal('')
  protected readonly busy = signal(false)
  protected readonly progress = signal('')
  protected readonly error = signal('')

  constructor() {
    void this.directory.meta()
  }

  protected summary(): string {
    const m = this.directory.metaSignal()
    if (!m) return ''
    const when = new Date(m.importedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${m.count.toLocaleString('en-US')} call signs from ${m.fileName}, imported ${when}`
      + (m.region ? `, for ${m.region}` : '')
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    this.busy.set(true)
    this.error.set('')
    this.progress.set('Starting')
    try {
      await this.directory.importFile(file, this.region(), p => {
        this.progress.set(`${p.phase}: ${p.rowsRead.toLocaleString('en-US')} read, ${p.rowsKept.toLocaleString('en-US')} kept`)
      })
      this.progress.set('')
    } catch (e) {
      this.progress.set('')
      this.error.set(e instanceof Error && e.message ? e.message : 'The list could not be read.')
    } finally {
      this.busy.set(false)
    }
  }

  protected async onRemove(): Promise<void> {
    this.error.set('')
    await this.directory.remove()
  }
}
