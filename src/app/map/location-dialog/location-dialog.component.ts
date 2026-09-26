import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

import { MATERIAL_IMPORTS } from '../../material-imports'
import { locationMarkerSvg, resolveLocationIcon } from '../../shared/mapping/location-marker'
import { locationCategoryColor } from '../../shared/mapping/report-marker-status'
import { LocationCategoryType, LogService, MissionLocationService, MissionLocationType } from '../../shared/services'

/** What a map engine hands in when opening this dialog - see each engine's own open call. */
export interface LocationDialogData {
  lat: number
  lng: number
  locationTypes: LocationCategoryType[]
  /** Present when editing a location already on the map; absent when placing a new one. */
  existing?: MissionLocationType
}

/**
 * ADR D-49: add/edit/delete for a single Location (Command Post, Staging Area, Ranger First
 * Aid, ...), opened by either map engine after a click - see LmapComponent/MapLibreComponent
 * for the "click the map to place it" flow this serves.
 *
 * Owns its own CRUD via `MissionLocationService` directly (constructor injection, same
 * pattern `MissionAdvancedOptionsComponent` uses) rather than returning data through
 * `afterClosed()` for the caller to act on - simpler for both map engines to open, and the
 * service's own `ReplaySubject` is what both engines already redraw markers from, so there is
 * nothing else for a caller to do once this dialog closes.
 *
 * Plain `FormsModule`/`ngModel` rather than `@angular/forms/signals` (D-27): this is four
 * independent fields with one validation rule (name required), not the shape of form D-27's
 * signal-forms adoption targets - see that ADR's own "incrementally" wording.
 */
@Component({
  selector: 'rangertrak-location-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './location-dialog.component.html',
  styleUrls: ['./location-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LocationDialogComponent {
  private id = 'Location Dialog Component'

  readonly isEditing = !!this.data.existing

  name = signal(this.data.existing?.name ?? '')
  type = signal(this.data.existing?.type ?? this.data.locationTypes[0]?.type ?? '')
  address = signal(this.data.existing?.address ?? '')
  note = signal(this.data.existing?.note ?? '')

  constructor(
    private dialogRef: MatDialogRef<LocationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: LocationDialogData,
    private locationService: MissionLocationService,
    private log: LogService,
    private sanitizer: DomSanitizer,
  ) { }

  /**
   * The marker preview shown next to each category option (E-117) - same
   * `resolveLocationIcon()` both map engines and the Mission locations list go through, so
   * what a scribe picks here always matches what lands on the map. `bypassSecurityTrustHtml`
   * mirrors `GuideDrawerComponent`'s identical need for hand-built (not user-sourced) markup.
   */
  markerFor(type: string): SafeHtml {
    const icon = resolveLocationIcon(type, this.data.locationTypes)
    const svg = locationMarkerSvg(icon, locationCategoryColor(type, this.data.locationTypes))
    return this.sanitizer.bypassSecurityTrustHtml(svg)
  }

  onSave(): void {
    const name = this.name().trim()
    if (!name) {
      return
    }

    const location: Omit<MissionLocationType, 'uid'> = {
      name,
      type: this.type(),
      lat: this.data.existing?.lat ?? this.data.lat,
      lng: this.data.existing?.lng ?? this.data.lng,
      address: this.address().trim() || undefined,
      note: this.note().trim() || undefined,
    }

    if (this.data.existing) {
      this.locationService.updateLocation({ ...location, uid: this.data.existing.uid })
      this.log.verbose(`Updated location "${name}"`, this.id)
    } else {
      this.locationService.addLocation(location)
      this.log.verbose(`Added location "${name}"`, this.id)
    }

    this.dialogRef.close()
  }

  onDelete(): void {
    const existing = this.data.existing
    if (!existing?.uid) {
      return
    }
    if (!confirm(`Delete "${existing.name}"? This cannot be undone.`)) {
      return
    }
    this.locationService.deleteLocationByUid(existing.uid)
    this.log.verbose(`Deleted location "${existing.name}"`, this.id)
    this.dialogRef.close()
  }

  onCancel(): void {
    this.dialogRef.close()
  }
}
