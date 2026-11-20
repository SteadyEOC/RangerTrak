import { Subscription } from 'rxjs'

import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { RouterLink } from '@angular/router'
import { MatCardModule } from '@angular/material/card'
import { LocationDialogComponent } from '../../../map-core/location-dialog/location-dialog.component'
import { locationMarkerSvg, resolveLocationIcon } from '../../../shared/mapping/location-marker'
import { locationCategoryColor } from '../../../shared/mapping/report-marker-status'
import { LogService, MissionLocationService, MissionLocationType, MissionService } from '../../../shared/services/'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/**
 * ADR D-49: a plain review/manage list of every Location on the current mission - raised
 * live 2026-08-30 after the map-click add/edit flow shipped with no way to see them all at
 * once or bulk-review/delete without hunting across the map. Deliberately a plain table, not
 * an ag-Grid clone: a handful of named points is exactly the "read the whole thing at a
 * glance" shape MessagesComponent's own doc comment already argues for over a grid, not the
 * "scan many rows across columns" shape ag-Grid earns its keep for.
 *
 * Edit reopens the SAME `LocationDialogComponent` the map uses (existing-location mode) -
 * one add/edit/delete surface, not a second one duplicated here. This component injects its
 * own services directly (MissionLocationService, MissionService, MatDialog), same "no parent
 * plumbing needed" pattern the map engines already use for the identical dialog.
 */
@Component({
  selector: 'rangertrak-mission-locations-list',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, MatCardModule, AdvancedDirective],
  templateUrl: './mission-locations-list.component.html',
  styleUrls: ['./mission-locations-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionLocationsListComponent implements OnInit, OnDestroy {
  private id = 'Mission Locations List Component'

  locations = signal<MissionLocationType[]>([])

  private locationsSubscription!: Subscription

  constructor(
    private locationService: MissionLocationService,
    private missionService: MissionService,
    private dialog: MatDialog,
    private log: LogService,
    private sanitizer: DomSanitizer,
  ) { }

  ngOnInit(): void {
    this.locationsSubscription = this.locationService.getLocationsObserver().subscribe({
      next: (newLocations) => this.locations.set(newLocations),
      error: (e) => this.log.error(`Locations subscription error: ${e}`, this.id),
    })
  }

  ngOnDestroy(): void {
    this.locationsSubscription?.unsubscribe()
  }

  colorFor(type: string): string {
    return locationCategoryColor(type, this.missionService.settings.locationTypes)
  }

  /**
   * The actual marker SVG for this location's category (E-117), not just its color swatch -
   * same `resolveLocationIcon()` both map engines and the location dialog go through, so a
   * category's icon here always matches what the map itself draws. `bypassSecurityTrustHtml`
   * mirrors `GuideDrawerComponent`'s identical need to bind hand-built SVG/HTML markup that
   * isn't sourced from user input.
   */
  markerFor(type: string): SafeHtml {
    const locationTypes = this.missionService.settings.locationTypes
    const icon = resolveLocationIcon(type, locationTypes)
    const svg = locationMarkerSvg(icon, locationCategoryColor(type, locationTypes))
    return this.sanitizer.bypassSecurityTrustHtml(svg)
  }

  onEdit(location: MissionLocationType): void {
    this.dialog.open(LocationDialogComponent, {
      data: {
        lat: location.lat,
        lng: location.lng,
        locationTypes: this.missionService.settings.locationTypes,
        existing: location,
      }
    })
  }

  onDelete(location: MissionLocationType): void {
    if (!location.uid) {
      return
    }
    if (!confirm(`Delete "${location.name}"? This cannot be undone.`)) {
      return
    }
    this.locationService.deleteLocationByUid(location.uid)
    this.log.info(`Deleted place ${location.uid} from the Mission page list.`, this.id)
  }
}
