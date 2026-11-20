import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'

import { formatBytes, formatFingerprint, isGone, isSmallerCopy, smallerCopyLabelIn } from '../../domain/attachments'
import type { AttachmentRef } from '../../domain/attachments'
import { AttachmentStoreService } from '../services/attachment-store.service'
import { LogService } from '../services/log.service'
import { RadioLogService } from '../services/radio-log.service'
import type { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'
import { UsageStateService } from '../services/usage-state.service'
import { AttachmentIntakeService } from './attachment-intake.service'
import type { PendingAttachment } from './attachment-intake.service'
import { PendingAttachmentsComponent } from './pending-attachments.component'
import { SmallerCopyDialogComponent } from './smaller-copy-dialog.component'
import type { SmallerCopyChoice, SmallerCopyDialogData } from './smaller-copy-dialog.component'
import { SmallerCopyService } from './smaller-copy.service'
import { ALREADY_SMALL_NOTE, downloadName } from './compress/compress-types'
import { SmallerCopyProgressComponent } from './smaller-copy-progress.component'

/** What opens the viewer: the entry (by its permanent uid) and, optionally, which file to show first. */
export interface AttachmentViewerData {
  uid: string
  sha256?: string
}

/** A swipe shorter than this many pixels is a tap, not a move to the next item. */
const SWIPE_PX = 50

/**
 * The one viewer for an entry's attachments (ADR D-60, E-194), opened from the 📎 chip
 * wherever it appears. Lazy-loaded (see AttachmentViewerService): nothing here is in the main
 * bundle.
 *
 * Bytes are read one at a time, when an item is shown (`loadMedia`), into an object URL that is
 * revoked as soon as the item changes or the dialog closes. The thumbnail strip uses the small
 * stored thumbnails. It reads the entry LIVE (by uid) so Add and Remove show at once.
 *
 * Confidential content (rule 5): nothing here is logged except counts.
 */
@Component({
  selector: 'rangertrak-attachment-viewer',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, PendingAttachmentsComponent, SmallerCopyProgressComponent],
  templateUrl: './attachment-viewer.component.html',
  styleUrls: ['./attachment-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AttachmentViewerComponent implements OnDestroy {
  private id = 'Attachment Viewer Component'

  private data = inject<AttachmentViewerData>(MAT_DIALOG_DATA)
  private store = inject(AttachmentStoreService)
  private radioLog = inject(RadioLogService)
  private intake = inject(AttachmentIntakeService)
  private smallerCopy = inject(SmallerCopyService)
  private dialog = inject(MatDialog)
  private usage = inject(UsageStateService)
  private log = inject(LogService)

  readonly entry = signal<RadioLogEntryType | undefined>(undefined)
  readonly refs = computed<AttachmentRef[]>(() => this.entry()?.attachments ?? [])
  readonly index = signal(0)
  readonly current = computed<AttachmentRef | undefined>(() => this.refs()[this.index()])
  private readonly currentSha = computed(() => this.current()?.sha256 ?? '')
  private readonly currentRemoved = computed(() => { const c = this.current(); return !!c && isGone(c) })
  private readonly stripKey = computed(() => this.refs().map(r => r.sha256 + (isGone(r) ? '-' : '+')).join(','))

  /** thumbnail object URLs by fingerprint ('' = none: show a type icon). */
  readonly thumbs = signal<Record<string, string>>({})
  /** 'loading' | 'ready' | 'elsewhere' (no bytes here) | 'removed' | 'error' */
  readonly state = signal<'loading' | 'ready' | 'elsewhere' | 'removed' | 'error'>('loading')
  readonly mediaUrl = signal('')
  readonly copied = signal(false)
  readonly busy = signal(false)
  readonly message = signal('')
  /** Files just picked with Add, waiting for the sender's choice (Keep original / Smaller copy). */
  readonly pending = signal<PendingAttachment[]>([])

  /** Whether the receiver's "Make a smaller copy..." is offered for the file on show (not already one, and this browser can do it). */
  readonly canMakeSmaller = signal(false)

  readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  private loadToken = 0
  private touchStartX: number | null = null

  constructor() {
    let picked = false
    this.radioLog.getRadioLogObserver().pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(radioLog => {
      const found = radioLog.logEntries.find(e => e.uid === this.data.uid)
      // A shallow copy, so the signal changes even though the entry is edited in place.
      this.entry.set(found ? { ...found } : undefined)
      if (found && !picked) {
        picked = true
        const at = found.attachments?.findIndex(r => r.sha256 === this.data.sha256) ?? -1
        this.index.set(Math.max(0, at))
      }
      // Removing the last one, say, can leave the index past the end.
      if (this.index() >= (found?.attachments?.length ?? 0)) this.index.set(Math.max(0, (found?.attachments?.length ?? 1) - 1))
    })

    effect(() => {
      this.stripKey()
      this.store.changes()
      untracked(() => void this.loadThumbs())
    })
    effect(() => {
      this.currentSha()
      this.currentRemoved()
      this.store.changes()
      untracked(() => void this.loadMedia())
    })
  }

  ngOnDestroy(): void {
    this.loadToken++
    this.revokeMedia()
  }

  // ── display helpers ──────────────────────────────────────────────────

  shortFingerprint(sha: string): string { return formatFingerprint(sha) }
  sizeText(bytes: number): string { return formatBytes(bytes) }
  gone(ref: AttachmentRef): boolean { return isGone(ref) }
  /** "Smaller copy, made on K7ABC's phone from 4.2 MB", or '' for an original. */
  smallerLabel(ref: AttachmentRef): string { const e = this.entry(); return e ? smallerCopyLabelIn(e, ref) : '' }

  kind(ref: AttachmentRef): 'image' | 'video' | 'audio' | 'other' {
    if (ref.type.startsWith('image/')) return 'image'
    if (ref.type.startsWith('video/')) return 'video'
    if (ref.type.startsWith('audio/')) return 'audio'
    return 'other'
  }

  iconFor(ref: AttachmentRef): string {
    const k = this.kind(ref)
    return k === 'video' ? 'videocam' : k === 'audio' ? 'audiotrack' : k === 'image' ? 'image' : 'attach_file'
  }

  /** "16/10/2026 14:02", local, 24-hour (this app uses a 24-hour clock throughout). */
  when(iso: string | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }

  clock(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  // ── moving between items ─────────────────────────────────────────────

  select(i: number): void { if (i >= 0 && i < this.refs().length) this.index.set(i) }
  next(): void { this.select(this.index() + 1) }
  previous(): void { this.select(this.index() - 1) }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') { this.next(); event.preventDefault() }
    else if (event.key === 'ArrowLeft') { this.previous(); event.preventDefault() }
  }

  onTouchStart(event: TouchEvent): void { this.touchStartX = event.changedTouches[0]?.clientX ?? null }

  onTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null) return
    const dx = (event.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX
    this.touchStartX = null
    if (dx <= -SWIPE_PX) this.next()
    else if (dx >= SWIPE_PX) this.previous()
  }

  // ── loading ──────────────────────────────────────────────────────────

  private revokeMedia(): void {
    const url = this.mediaUrl()
    if (url) URL.revokeObjectURL(url)
    this.mediaUrl.set('')
  }

  private async loadThumbs(): Promise<void> {
    const out: Record<string, string> = {}
    for (const ref of this.refs()) {
      if (isGone(ref) || out[ref.sha256] !== undefined) continue
      try { out[ref.sha256] = await this.store.thumbUrl(ref.sha256) } catch { out[ref.sha256] = '' }
    }
    this.thumbs.set(out)
  }

  private async loadMedia(): Promise<void> {
    const token = ++this.loadToken
    this.revokeMedia()
    this.canMakeSmaller.set(false)
    const ref = this.current()
    if (!ref) { this.state.set('loading'); return }
    if (isGone(ref)) { this.state.set('removed'); return }
    this.state.set('loading')
    try {
      if (!(await this.store.has(ref.sha256))) {
        if (token === this.loadToken) this.state.set('elsewhere')
        return
      }
      const blob = await this.store.getOriginal(ref.sha256)
      if (token !== this.loadToken) return
      this.mediaUrl.set(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: ref.type })))
      this.state.set('ready')
      if (!isSmallerCopy(ref)) {
        const can = await this.smallerCopy.canOffer(new File([blob], ref.name, { type: ref.type })).catch(() => false)
        if (token === this.loadToken) this.canMakeSmaller.set(can)
      }
    } catch (e: any) {
      this.log.error(`Could not open an attachment: ${e?.message ?? e}`, this.id)
      if (token === this.loadToken) this.state.set('error')
    }
  }

  // ── actions ──────────────────────────────────────────────────────────

  /** Copies a fingerprint: this file's own (the default) or, for a smaller copy, the original's. */
  async onCopyFingerprint(sha256?: string): Promise<void> {
    const ref = this.current()
    const value = sha256 ?? ref?.sha256
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      this.copied.set(true)
      setTimeout(() => this.copied.set(false), 2000)
    } catch {
      // Clipboard blocked: show the full value so it can be copied by hand.
      prompt('Fingerprint (SHA-256), select and copy:', value)
    }
  }

  /** Downloads the original under its own name, byte for byte. */
  async onSave(): Promise<void> {
    const ref = this.current()
    if (!ref || isGone(ref)) return
    try {
      const blob = await this.store.getOriginal(ref.sha256)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName(ref.name, !!ref.compressed)
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) {
      this.message.set('Could not save that file.')
      this.log.error(`Could not save an attachment: ${e?.message ?? e}`, this.id)
    }
  }

  async onShare(): Promise<void> {
    const ref = this.current()
    if (!ref || isGone(ref)) return
    try {
      const file = new File([await this.store.getOriginal(ref.sha256)], downloadName(ref.name, !!ref.compressed), { type: ref.type })
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        this.message.set('This device cannot share that kind of file. Use Save instead.')
        return
      }
      await navigator.share({ files: [file], title: ref.name })
    } catch (e: any) {
      // Closing the share sheet is an AbortError, not a failure.
      if (e?.name !== 'AbortError') this.message.set('Could not share that file. Use Save instead.')
    }
  }

  /**
   * Add: the same questions as Entry's Attach, then the sender's choice. Where no picked file can be
   * made smaller here there is nothing to choose, so they are attached at once; otherwise they wait
   * as chips until "Attach" (D-60 item 2, revised: "Keep original" is the default).
   */
  async onAdd(input: HTMLInputElement): Promise<void> {
    const entry = this.entry()
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!entry?.uid || !files.length) return
    this.busy.set(true)
    this.message.set('')
    try {
      const accepted = await this.intake.vet(files, this.pending().reduce((sum, p) => sum + p.file.size, 0))
      const pended = await this.intake.pend(accepted)
      if (pended.some(p => p.offer)) this.pending.update(list => [...list, ...pended])
      else await this.attachNow(entry.uid, pended)
    } finally {
      this.busy.set(false)
    }
  }

  async onAttachPending(): Promise<void> {
    const entry = this.entry()
    const items = this.pending()
    if (!entry?.uid || !items.length) return
    this.busy.set(true)
    this.message.set('')
    try {
      this.pending.set([])
      await this.attachNow(entry.uid, items)
    } finally {
      this.busy.set(false)
    }
  }

  private async attachNow(uid: string, items: PendingAttachment[]): Promise<void> {
    const { added, failed, notes } = await this.intake.attach(uid, items, true)
    const lines = [...new Set(notes)]
    if (failed.length) lines.push(`Could not attach: ${failed.join(', ')}.`)
    this.message.set(lines.join(' '))
    const first = added[0]
    if (first) {
      const at = this.refs().findIndex(r => r.sha256 === first.sha256)
      if (at >= 0) this.index.set(at)
    }
  }

  /**
   * The receiver's smaller copy (D-60 item 2, revised): behind a stronger warning, the default keeps
   * the original and adds the copy beside it, and replacing needs a typed REPLACE in any mode. The
   * original's own reference says who sent it (`addedBy`); the copy's note says who made it.
   */
  async onSmallerCopy(): Promise<void> {
    const entry = this.entry()
    const ref = this.current()
    if (!entry?.uid || !ref || isGone(ref) || isSmallerCopy(ref)) return
    const choice = await new Promise<SmallerCopyChoice | undefined>(resolve => {
      const data: SmallerCopyDialogData = { from: ref.addedBy, kind: this.kind(ref) }
      this.dialog.open(SmallerCopyDialogComponent, { data, autoFocus: false, maxWidth: '96vw' })
        .afterClosed().subscribe(result => resolve(result))
    })
    if (!choice) return
    this.busy.set(true)
    this.message.set('')
    try {
      const original = new File([await this.store.getOriginal(ref.sha256)], ref.name, {
        type: ref.type, ...(ref.capturedAt ? { lastModified: Date.parse(ref.capturedAt) } : {}),
      })
      const made = await this.smallerCopy.make(original)
      if (typeof made !== 'object') {
        this.message.set(made === 'not-smaller' ? ALREADY_SMALL_NOTE
          : made === 'cancelled' ? 'The smaller copy was cancelled; the original was kept.'
            : 'A smaller copy could not be made; the original was kept.')
        return
      }
      const by = this.intake.operatorName()
      const now = new Date().toISOString()
      const copy: AttachmentRef = {
        ...(await this.store.add(made.file, by)),
        compressed: { ...made.compressed, at: now, by, where: 'receiver' },
      }
      const refs = choice === 'replace'
        ? [copy, { ...ref, replaced: { at: now, by, bySha256: copy.sha256 } }]
        : [copy]
      this.radioLog.mergeEntryAttachments(entry.uid, refs, true)
      if (choice === 'replace') {
        const entries = this.radioLog.getCurrentRadioLog().logEntries
        await this.store.releaseRemoved(entries)
        await this.store.sweepOrphans(entries)
      }
      const at = this.refs().findIndex(r => r.sha256 === copy.sha256)
      if (at >= 0) this.index.set(at)
    } catch (e: any) {
      this.log.error(`Could not make a smaller copy: ${e?.message ?? e}`, this.id)
      this.message.set('Could not make a smaller copy.')
    } finally {
      this.busy.set(false)
    }
  }

  /**
   * Removal leaves a trace (D-60 item 5): the reference stays, marked with when and by whom;
   * the bytes go (unless another live reference still names the same file). In Incident mode
   * the confirm is typed, like the other destructive confirms on live missions.
   */
  async onRemove(): Promise<void> {
    const entry = this.entry()
    const ref = this.current()
    if (!entry?.uid || !ref || isGone(ref)) return
    const question = `Remove "${ref.name}" from this entry?\n\n`
      + `The file is deleted from this device. The entry keeps a note that it was removed, and when and by whom.`
    if (this.usage.mode() === 'incident') {
      const typed = prompt(`${question}\n\nThis is a real incident. To go ahead, type  REMOVE  below.`)
      if (typed === null || typed.trim().toLowerCase() !== 'remove') return
    } else if (!confirm(question)) {
      return
    }
    this.busy.set(true)
    try {
      const removed: AttachmentRef = { ...ref, removed: { at: new Date().toISOString(), by: this.intake.operatorName() } }
      this.radioLog.mergeEntryAttachments(entry.uid, [removed], true)
      const entries = this.radioLog.getCurrentRadioLog().logEntries
      await this.store.releaseRemoved(entries)
      await this.store.sweepOrphans(entries)
      this.message.set('')
    } finally {
      this.busy.set(false)
    }
  }
}
