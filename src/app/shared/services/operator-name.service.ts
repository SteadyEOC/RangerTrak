import { Injectable, signal } from '@angular/core'

/**
 * The operator name typed on the Entry page, shared in memory only so the Print map sheet can
 * pre-fill "Prepared by". Deliberately NOT persisted anywhere (no localStorage, IndexedDB or
 * settings): it lasts until the page is reloaded, same as Entry's own operator box (D-44).
 */
@Injectable({ providedIn: 'root' })
export class OperatorNameService {
  readonly name = signal('')
}
