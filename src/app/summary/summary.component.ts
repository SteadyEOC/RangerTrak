import { CommonModule } from '@angular/common'
import {
  ApplicationRef, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject,
  signal, viewChild,
} from '@angular/core'
import { RouterLink } from '@angular/router'
import { Subscription } from 'rxjs'

import {
  MissionSummary, NOT_RECORDED_LABEL, summarizeMission,
} from '../domain/mission-summary'
import { formatStation } from '../domain/station-label'
import { printAttachments } from '../domain/attachments'
import { formatMsgNoFull, formatMsgNoShort } from '../domain/msg-no'
import { AttachmentStoreService } from '../shared/services/attachment-store.service'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { AAR_CAPABILITY_LABELS } from '../shared/services/aar-note.interface'
import { PrintBrandComponent } from '../shared/print-brand/print-brand.component'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatCardModule } from '@angular/material/card'
import { downloadCsv } from '../shared/export/csv'
import { formatOperationalPeriod, hasOperationalPeriod } from '../shared/export/ics309-log'
import { buildSummaryCsv, summaryCsvFilename, SummaryStamp } from '../shared/export/mission-summary-csv'
import { showFirstPrintTip } from '../shared/export/print-tip'
import { armPrintTitle } from '../shared/export/print-title'
import { PageComponent } from '../shared/page/page.component'
import {
  AarNoteService, LogService, MissionService, MissionType, OperatorNameService, RadioLogEntryType, RadioLogService,
  RangerService, RangerType, UsageStateService, statusColorValue,
} from '../shared/services'
import { TimePickerComponent } from '../shared/time-picker/time-picker.component'

type WindowChoice = 'op' | 'whole' | 'custom'

/** Charts never draw wider than this, so a printed chart is about the size it was on screen. */
const CHART_MAX_WIDTH = 720
const CHART_MIN_WIDTH = 280

/**
 * E-189: where the mission stands. Everything is computed live from the radio log, the roster,
 * the mission settings and the AAR notes each time they change; nothing is stored, and nothing
 * here locks or stops anything (the numbers come from domain/mission-summary.ts). The printout
 * and the CSV are the snapshot, stamped with when they were generated and what they cover.
 *
 * No chart library (offline, bundle size): the two charts are inline SVG drawn by the template.
 */
@Component({
  selector: 'rangertrak-summary',
  standalone: true,
  imports: [CommonModule, RouterLink, PageComponent, TimePickerComponent, MatIconModule, MatButtonModule, MatButtonToggleModule, MatCardModule, PrintBrandComponent],
  templateUrl: './summary.component.html',
  styleUrls: ['./summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SummaryComponent implements OnDestroy {
  /** HSEEP's capability element (POETE) names, for the AAR notes section. */
  readonly capabilityLabels = AAR_CAPABILITY_LABELS
  title = 'RangerTrak SitRep'
  pageDescr = 'Where the mission stands: traffic, teams and notes for a period you choose, from this radio log (not an ICS-209). '
    + 'It only reads the radio log, so logging carries on as normal.'

  private radioLogService = inject(RadioLogService)
  private rangerService = inject(RangerService)
  private missionService = inject(MissionService)
  private aarNotes = inject(AarNoteService)
  private operatorName = inject(OperatorNameService)
  private usage = inject(UsageStateService)
  private appRef = inject(ApplicationRef)
  private log = inject(LogService)
  protected journal = inject(MissionJournalService)
  private id = 'Summary Component'

  // ---- live inputs (copied into signals; the services push onto their arrays in place) ----
  private entries = signal<readonly RadioLogEntryType[]>([...this.radioLogService.getCurrentRadioLog().logEntries])
  private rangers = signal<readonly RangerType[]>([...this.rangerService.rangers])
  readonly settings = signal<MissionType>(this.missionService.settings)
  private subs: Subscription[] = [
    this.radioLogService.getRadioLogObserver().subscribe(l => this.entries.set([...l.logEntries])),
    this.rangerService.getRangersObserver().subscribe(r => this.rangers.set([...r])),
    this.missionService.getMissionObserver().subscribe(m => this.settings.set(m)),
  ]

  // ---- window choice (not remembered across page loads) ----
  /** True when the mission has a usable operational period (both ends set, end after start). */
  readonly hasOpPeriod = computed(() => {
    const s = this.settings()
    const a = new Date(s?.opPeriodStart).getTime()
    const b = new Date(s?.opPeriodEnd).getTime()
    return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > a
  })
  /**
   * Opens on the op period only when it holds at least one entry. A new mission always gets op
   * period dates (stamped at creation, see mission.service.ts initMission), so "both dates set"
   * alone would open a demo or an older log on an empty summary.
   */
  readonly choice = signal<WindowChoice>(this.opPeriodHasEntries() ? 'op' : 'whole')
  readonly customFrom = signal(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))
  readonly customTo = signal(new Date())
  readonly customBackwards = computed(() => this.customTo().getTime() < this.customFrom().getTime())
  /** Bumped by Refresh and by Print/Export, so "generated at" is the moment they were asked for. */
  private tick = signal(0)

  private opPeriodHasEntries(): boolean {
    if (!this.hasOpPeriod()) return false
    const s = this.settings()
    const from = new Date(s.opPeriodStart).getTime()
    const to = new Date(s.opPeriodEnd).getTime()
    return this.entries().some(e => {
      const t = new Date(e.date).getTime()
      return t >= from && t <= to
    })
  }

  readonly opPeriodName = computed(() => this.settings()?.opPeriod?.trim() ?? '')
  readonly opPeriodToggleLabel = computed(() =>
    this.opPeriodName() ? `This op period (${this.opPeriodName()})` : 'This op period')

  private windowInput = computed<{ from: Date; to: Date } | null>(() => {
    const s = this.settings()
    switch (this.choice()) {
      case 'op':
        return this.hasOpPeriod() ? { from: new Date(s.opPeriodStart), to: new Date(s.opPeriodEnd) } : null
      case 'custom': {
        const from = this.customFrom()
        return { from, to: this.customBackwards() ? from : this.customTo() }
      }
      default:
        return null
    }
  })

  readonly summary = computed<MissionSummary>(() => {
    this.tick()
    return summarizeMission({
      entries: this.entries(),
      rangers: this.rangers(),
      statuses: this.settings()?.radioLogStatuses ?? [],
      notes: this.aarNotes.notes(),
      window: this.windowInput(),
      now: new Date(),
    })
  })

  // ---- the stamp ----
  readonly isExercise = computed(() => this.usage.mode() === 'exercise')
  /** E-196 (D-66): the scenario time when the summary was generated; '' unless Exercise mode with a clock set. */
  readonly scenarioLine = computed(() => this.usage.scenarioLabelAt(this.summary().generatedAt))
  readonly scenarioHint = computed(() => this.usage.scenarioHintAt(this.summary().generatedAt))
  readonly missionName = computed(() => {
    const s = this.settings()
    return s?.event?.trim() || s?.mission?.trim() || ''
  })
  readonly opPeriodLabel = computed(() => {
    const s = this.settings()
    return s && hasOperationalPeriod(s) ? formatOperationalPeriod(s) : ''
  })
  readonly windowLabel = computed(() => {
    const { window: w, totals } = this.summary()
    if (w.wholeLog) {
      return totals.entries ? `Whole log: ${this.fmt(w.from)} to ${this.fmt(w.to)}` : 'Whole log'
    }
    return `${this.fmt(w.from)} to ${this.fmt(w.to)}`
  })
  readonly generatedBy = computed(() => this.operatorName.name().trim())

  private stamp(): SummaryStamp {
    return {
      mission: this.missionName(),
      opPeriod: this.opPeriodLabel(),
      windowLabel: this.windowLabel(),
      generatedBy: this.generatedBy(),
      exercise: this.isExercise(),
    }
  }

  // ---- charts ----
  private readonly chartBox = viewChild<ElementRef<HTMLElement>>('chartBox')
  readonly chartWidth = signal(CHART_MAX_WIDTH)
  readonly notRecorded = NOT_RECORDED_LABEL

  // E-194: the needs-attention rows list their attachments (name, short fingerprint) and print the
  // stored thumbnail for an image. Read for the rows on screen only.
  private attachmentStore = inject(AttachmentStoreService)
  readonly printThumbs = signal<Record<string, string>>({})
  attachmentsOf = printAttachments

  constructor() {
    effect(() => {
      const shas = this.summary().attention.flatMap(e => printAttachments(e).filter(a => a.isImage).map(a => a.sha256))
      void (async () => {
        const out: Record<string, string> = {}
        for (const sha of shas) out[sha] = await this.attachmentStore.thumbUrl(sha).catch(() => '')
        this.printThumbs.set(out)
      })()
    })
    // Draw the charts at the width they are shown at, so their text stays readable on a phone.
    effect(onCleanup => {
      const el = this.chartBox()?.nativeElement
      if (!el || typeof ResizeObserver === 'undefined') return
      const ro = new ResizeObserver(([e]) => {
        const w = Math.round(e.contentRect.width)
        if (w > 0) this.chartWidth.set(Math.min(CHART_MAX_WIDTH, Math.max(CHART_MIN_WIDTH, w)))
      })
      ro.observe(el)
      onCleanup(() => ro.disconnect())
    })
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe())
  }

  readonly bucketTitle = computed(() => {
    const h = this.summary().buckets.hours
    return h === 1 ? 'Messages per hour' : h === 24 ? 'Messages per day' : `Messages per ${h} hours`
  })

  /** Chart 1: messages over time. Vertical bars, the attention share drawn over the foot of each. */
  readonly timeChart = computed(() => {
    const { items, hours } = this.summary().buckets
    const width = this.chartWidth()
    const height = 230
    const m = { left: 34, right: 8, top: 14, bottom: 38 }
    const plotW = width - m.left - m.right
    const plotH = height - m.top - m.bottom
    const max = Math.max(1, ...items.map(b => b.count))
    const step = plotW / items.length
    const barW = Math.max(1, step * 0.78)
    const base = m.top + plotH
    const labelEvery = Math.max(1, Math.ceil(items.length / Math.max(1, Math.floor(plotW / 52))))
    let lastDay = ''
    const bars = items.map((b, i) => {
      const x = m.left + i * step + (step - barW) / 2
      const total = b.count ? Math.max(1, (b.count / max) * plotH) : 0
      const attn = b.attentionCount ? Math.min(total, Math.max(1, (b.attentionCount / max) * plotH)) : 0
      const day = this.fmtDay(b.start)
      let label: { x: number; time: string; day: string } | null = null
      if (i % labelEvery === 0) {
        label = { x: x + barW / 2, time: hours < 24 ? this.fmtClock(b.start) : day, day: hours < 24 && day !== lastDay ? day : '' }
        lastDay = day
      }
      const what = `${b.count} ${b.count === 1 ? 'message' : 'messages'}`
        + (b.attentionCount ? `, ${b.attentionCount} needing attention` : '')
      return {
        x, w: barW, yTotal: base - total, hTotal: total, yAttn: base - attn, hAttn: attn, label,
        tip: `${this.fmt(b.start)}: ${what}`,
      }
    })
    return { width, height, left: m.left, right: width - m.right, top: m.top, base, max, bars }
  })

  readonly timeChartAria = computed(() => {
    const s = this.summary()
    const items = s.buckets.items
    const peak = items.reduce((a, b) => (b.count > a.count ? b : a), items[0])
    const unit = s.buckets.hours === 1 ? 'hour' : s.buckets.hours === 24 ? 'day' : `${s.buckets.hours}-hour period`
    return `${this.bucketTitle()}. ${s.totals.entries} messages in all. `
      + `Busiest ${unit}: starting ${this.fmt(peak.start)}, ${peak.count} ${peak.count === 1 ? 'message' : 'messages'}.`
  })

  /** Chart 2: traffic by team. Horizontal bars. */
  readonly teamChart = computed(() => {
    const rows = this.summary().byTeam
    const width = this.chartWidth()
    const rowH = 26
    const labelW = Math.min(200, Math.round(width * 0.4))
    const maxChars = Math.max(6, Math.floor(labelW / 6.8))
    const barLeft = labelW + 8
    const room = width - barLeft - 40
    const max = Math.max(1, ...rows.map(r => r.count))
    return {
      width,
      height: rows.length * rowH + 8,
      labelW,
      bars: rows.map((r, i) => {
        const w = Math.max(2, (r.count / max) * room)
        // Stacked by status: each slice is its share of the bar, in the mission's status order.
        const parts = this.summary().byTeamStatus[r.label] ?? []
        let used = 0
        const segs = parts.map(p => {
          const x = barLeft + used
          const sw = (p.count / r.count) * w
          used += sw
          return { x, w: sw, fill: this.statusFillFor(p.status), tip: `${p.status}: ${p.count}` }
        })
        return {
        y: 4 + i * rowH,
        w,
        segs,
        detail: parts.map(p => `${p.status} ${p.count}`).join(', '),
        label: r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label,
        full: r.label,
        count: r.count,
        barLeft,
        h: rowH - 8,
        }
      }),
    }
  })

  teamStatusText(team: string): string {
    return (this.summary().byTeamStatus[team] ?? []).map(p => `${p.status} ${p.count}`).join(', ')
  }

  readonly teamChartAria = computed(() => {
    const rows = this.summary().byTeam
    if (!rows.length) return 'Traffic by team: no entries.'
    return `Traffic by team. ${rows.length} ${rows.length === 1 ? 'team' : 'teams'}. `
      + `Busiest: ${rows[0].label}, ${rows[0].count} ${rows[0].count === 1 ? 'message' : 'messages'}. `
      + rows.map(r => {
        const parts = this.summary().byTeamStatus[r.label] ?? []
        return `${r.label}: ${r.count}` + (parts.length ? ` (${parts.map(p => `${p.status} ${p.count}`).join(', ')})` : '')
      }).join('; ') + '.'
  })

  // ---- formatting ----
  /** E-220: the message number beside the time, short ('A007'); the full form is its tooltip. */
  msgNoShort(e: { msgNo?: RadioLogEntryType['msgNo'] }): string { return formatMsgNoShort(e.msgNo) }
  msgNoFull(e: { msgNo?: RadioLogEntryType['msgNo'] }): string { return formatMsgNoFull(e.msgNo) }

  fmt(d: Date | string | undefined | null): string {
    const date = d ? new Date(d) : null
    if (!date || isNaN(date.getTime())) return ''
    return date.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }
  private fmtClock(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  private fmtDay(d: Date): string {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  station(e: RadioLogEntryType): string {
    return formatStation(e.tacticalCall, e.callsign) || '(no call sign)'
  }
  statusFill(color: string): string { return statusColorValue(color) }
  statusFillFor(status: string): string {
    const s = this.settings()?.radioLogStatuses?.find(x => x.status === status)
    return statusColorValue(s ? s.color : '#A3A3A3')
  }

  // ---- actions ----
  onChoice(value: WindowChoice): void { this.choice.set(value) }
  onCustomFrom(d: Date): void { this.customFrom.set(d) }
  onCustomTo(d: Date): void { this.customTo.set(d) }
  refresh(): void { this.tick.update(n => n + 1) }

  /** Same body-class technique as AAR notes and the ICS-309: hides the app chrome on paper. */
  onPrint(): void {
    this.refresh()
    this.appRef.tick() // the page must show the same moment the paper is stamped with
    showFirstPrintTip()
    document.body.classList.add('rt-print-summary')
    window.addEventListener('afterprint', () => document.body.classList.remove('rt-print-summary'), { once: true })
    const untitle = armPrintTitle('SitRep', this.settings())
    // E-222: recorded first, so the head printed on the sheet includes this print.
    this.journal.record('print-summary', 'Printed the SitRep.')
    this.appRef.tick()
    window.print()
    untitle()
    document.body.classList.remove('rt-print-summary')
  }

  onExportCsv(): void {
    this.refresh()
    const s = this.summary()
    const filename = summaryCsvFilename(this.missionName(), s.generatedAt)
    downloadCsv(buildSummaryCsv(s, this.stamp()), filename)
    this.journal.record('summary-exported', `Exported the SitRep to ${filename}.`)
  }
}
