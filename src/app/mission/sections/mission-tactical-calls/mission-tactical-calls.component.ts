import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'

import { RangerService, RangerType, TacticalCallType } from '../../../shared/services/'
import { MATERIAL_IMPORTS } from '../../../material-imports'

/** One editable line: the tactical name, the roster link, and the operator box's own text. */
type Row = { name: string, rangerUid: string, operatorText: string }

/**
 * E-165 (2026-09-30): the mission's tactical call list - "Vashon EOC", "CERT Team 1" - each
 * optionally staffed by one roster member. Entry's From and To station pickers offer these, and
 * copy the staffed member's call sign onto the entry at save time (see
 * `RadioLogEntryType.tacticalCall`), so the FCC call that goes on the paperwork is recorded
 * without the scribe having to hunt for it on a busy net.
 *
 * Modelled on `MissionRecipients213Component`: the parent owns the list and this emits the new
 * one (`itemsChange`). A row is a name plus an operator picker rather than a single line of
 * text because the operator is a roster LINK (a uid) - never a copied name or call sign, so no
 * new PII lands in the mission settings (CLAUDE.md rule 5).
 *
 * The picker filters on name, call sign OR Ranger ID - the same three fields Entry's own
 * picker matches (D-42/D-43) - so an unlicensed member (no call sign) is assignable. An
 * assignment whose ranger has since been deleted shows as unassigned; the row is kept.
 */
@Component({
  selector: 'rangertrak-mission-tactical-calls',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './mission-tactical-calls.component.html',
  styleUrls: ['./mission-tactical-calls.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionTacticalCallsComponent implements OnChanges {
  @Input({ required: true }) items: TacticalCallType[] = []
  @Output() itemsChange = new EventEmitter<TacticalCallType[]>()

  private rangerService = inject(RangerService)

  /** The live roster, so a deleted/renamed member is reflected without reloading the page. */
  readonly rangers = signal<RangerType[]>([])

  /** The rows being edited. Re-seeded from `items` only when the parent hands a different list. */
  rows = signal<Row[]>([])

  constructor() {
    this.rangerService.getRangersObserver().pipe(takeUntilDestroyed())
      .subscribe(list => {
        this.rangers.set(list)
        // A roster change can turn an assignment into "unassigned" (member deleted) or change
        // the label a still-assigned member shows under.
        this.rows.update(rows => rows.map(r => ({ ...r, operatorText: this.labelFor(r.rangerUid) })))
      })
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items'] && !this.sameAsRows(this.items)) {
      this.rows.set(this.items.map(i => ({
        name: i.name, rangerUid: i.rangerUid ?? '', operatorText: this.labelFor(i.rangerUid ?? ''),
      })))
    }
  }

  /** What the operator box shows for an assigned member: call sign, else name. Blank when none/deleted. */
  labelFor(uid: string): string {
    const r = this.rangerByUid(uid)
    return r ? (r.callsign?.trim() || r.fullName?.trim() || r.id?.trim() || '') : ''
  }

  private rangerByUid(uid: string): RangerType | undefined {
    return uid ? this.rangers().find(r => r.uid === uid) : undefined
  }

  /** Same matching as Entry's autocomplete (D-42/D-43): name, call sign or Ranger ID. */
  matches(filter: string): RangerType[] {
    const f = filter.trim().toLowerCase()
    const list = this.rangers()
    if (!f) return list.slice()
    return list.filter(r =>
      r.callsign?.toLowerCase().includes(f)
      || r.fullName?.toLowerCase().includes(f)
      || r.id?.toLowerCase().includes(f))
  }

  /** A name already used by an earlier row (case-insensitive, trimmed) - names must be unique. */
  isDuplicate(index: number): boolean {
    const rows = this.rows()
    const key = rows[index].name.trim().toLowerCase()
    return !!key && rows.findIndex(r => r.name.trim().toLowerCase() === key) < index
  }

  onAdd() {
    this.rows.update(rows => [...rows, { name: '', rangerUid: '', operatorText: '' }])
  }

  onRemove(index: number) {
    this.rows.update(rows => rows.filter((_, i) => i !== index))
    this.emit()
  }

  onNameChange(index: number, value: string) {
    this.rows.update(rows => rows.map((r, i) => i === index ? { ...r, name: value } : r))
  }

  onOperatorPicked(index: number, uid: string) {
    this.rows.update(rows => rows.map((r, i) =>
      i === index ? { ...r, rangerUid: uid, operatorText: this.labelFor(uid) } : r))
    this.emit()
  }

  onOperatorText(index: number, value: string) {
    this.rows.update(rows => rows.map((r, i) => i === index ? { ...r, operatorText: value } : r))
  }

  /** Blank text unassigns; anything else that isn't a picked option snaps back to the assignment. */
  onOperatorBlur(index: number) {
    // Deferred: clicking an autocomplete option blurs the box BEFORE the option's own click is
    // delivered, and snapping the text back at that instant would swallow the pick.
    setTimeout(() => this.settleOperatorText(index), 200)
  }

  private settleOperatorText(index: number) {
    const row = this.rows()[index]
    if (!row) return
    if (!row.operatorText.trim()) {
      if (row.rangerUid) {
        this.onOperatorPicked(index, '')
      }
      return
    }
    this.rows.update(rows => rows.map((r, i) =>
      i === index ? { ...r, operatorText: this.labelFor(r.rangerUid) } : r))
  }

  /** Parsed on blur like the recipients textarea, so a half-typed name never registers. */
  onNameBlur() {
    this.emit()
  }

  /**
   * Only rows with a non-empty, not-yet-used name are saved - a duplicate keeps showing its own
   * error and is left out until renamed. The `rangerUid` of an assignment whose ranger was
   * deleted is kept as-is (it reads as unassigned), so re-importing the roster restores it.
   */
  private emit() {
    const seen = new Set<string>()
    const out: TacticalCallType[] = []
    for (const r of this.rows()) {
      const name = r.name.trim()
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      out.push(r.rangerUid ? { name, rangerUid: r.rangerUid } : { name })
    }
    this.itemsChange.emit(out)
  }

  private sameAsRows(items: TacticalCallType[]): boolean {
    const saved = this.rows().filter(r => r.name.trim()).map(r => `${r.name.trim()}|${r.rangerUid}`)
    return saved.length === items.length && items.every((i, n) => `${i.name}|${i.rangerUid ?? ''}` === saved[n])
  }
}
