import { Injectable, signal } from '@angular/core'

import {
  LayerImport, LayerKind, LayerRecord, leftThisLayer, parseLayers, pruneLayers, recordLayerImport,
  removalFor, serializeLayers, withoutLayer,
} from '../../domain/layers'
import { recordStore } from '../storage/record-store'

/**
 * The layers this device holds (E-187 phase C, ADR D-58 points 6 and 7). It only stores and
 * gathers: every rule is a pure function in `domain/layers.ts`. The list lives in RecordStore
 * beside the roster because it is lists of roster and place uids, so it is encrypted with the
 * roster when the device is.
 *
 * Deliberately NOT in the services barrel and not injected by an always-loaded service: only
 * the lazy Rangers / Map import code and the backup path use it, which keeps it out of the
 * initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class LayerService {
  private readonly key = 'layers'

  /** Every layer record, people and places. A fresh array on each change. */
  readonly layers = signal<LayerRecord[]>(this.read())

  private read(): LayerRecord[] {
    return parseLayers(recordStore.getItem(this.key))
  }

  private write(next: LayerRecord[]): void {
    recordStore.setItem(this.key, serializeLayers(next))
    this.layers.set(next)
  }

  /** Re-reads storage (after a restore wrote it behind this service's back, or, E-313, after the main window wrote it). */
  reload(): void {
    this.layers.set(this.read())
  }

  /** E-313: the same name every service a pop-out refreshes uses. Never writes. */
  reloadFromStore(): void {
    this.reload()
  }

  /** Raw list for a mission backup. */
  snapshot(): LayerRecord[] {
    return [...this.layers()]
  }

  /** Replaces the list wholesale (restoring a mission backup). */
  replaceAll(next: LayerRecord[]): void {
    this.write(parseLayers({ layers: next }))
  }

  /** What a re-import of this layer would ask about, computed before the import is recorded. */
  leftBehind(name: string, kind: LayerKind, newUids: readonly string[]): string[] {
    return leftThisLayer(this.layers(), name, kind, newUids)
  }

  record(imp: LayerImport): void {
    this.write(recordLayerImport(this.layers(), imp))
  }

  /** What "Remove this layer" would take out and what it would keep. */
  removalFor(name: string, kind: LayerKind) {
    return removalFor(this.layers(), name, kind)
  }

  /** Forgets the layer's record. The caller removes the records it listed. */
  forget(name: string, kind: LayerKind): void {
    this.write(withoutLayer(this.layers(), name, kind))
  }

  /** Forgets uids that are no longer on the device (after a replace, a restore or a delete-all). */
  prune(kind: LayerKind, liveUids: ReadonlySet<string>): void {
    this.write(pruneLayers(this.layers(), kind, liveUids))
  }
}
