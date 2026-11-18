import { Injectable, inject } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'

import type { ActivityLogHeader, ActivityRow } from '../../domain/activity-log'
import type { Ics309MissionInfo } from '../export/ics309-log'
import type { RadioPayload } from '../export/radio-send/mapping'
import type { RadioLogEntryType } from '../services/radio-log-entry.interface'
import { MissionService } from '../services/mission.service'
import type { SendByRadioData } from './send-by-radio-dialog.component'

/**
 * E-307: opens the Send by radio dialog for a form. The dialog, the mapping and the emcomm-forms writers
 * are all loaded here, when a button is pressed, so none of them is in the eager bundle. Callers show their
 * button in Full menus only (view.isShown('send-by-radio')).
 */
@Injectable({ providedIn: 'root' })
export class SendByRadioService {
  private readonly dialog = inject(MatDialog)
  private readonly missionService = inject(MissionService)

  async open213(report: RadioLogEntryType): Promise<void> {
    const { ics213Payload } = await import('../export/radio-send/mapping')
    await this.show(ics213Payload(report, this.missionService.settings), report)
  }

  async open213rr(report: RadioLogEntryType): Promise<void> {
    const { ics213rrPayload } = await import('../export/radio-send/mapping')
    await this.show(ics213rrPayload(report, this.missionService.settings), report)
  }

  async open309(reports: readonly RadioLogEntryType[], mission: Ics309MissionInfo, preparedBy = ''): Promise<void> {
    const { ics309Payload } = await import('../export/radio-send/mapping')
    await this.show(ics309Payload(reports, mission, new Date(), preparedBy))
  }

  async open214(header: ActivityLogHeader, rows: readonly ActivityRow[]): Promise<void> {
    const { ics214Payload } = await import('../export/radio-send/mapping')
    await this.show(ics214Payload(header, this.missionService.settings, rows, new Date()))
  }

  private async show(payload: RadioPayload, report?: RadioLogEntryType): Promise<void> {
    const { SendByRadioDialogComponent } = await import('./send-by-radio-dialog.component')
    const data: SendByRadioData = { payload, ...(report ? { report } : {}) }
    this.dialog.open(SendByRadioDialogComponent, { data, maxWidth: '95vw', autoFocus: 'first-tabbable' })
  }
}
