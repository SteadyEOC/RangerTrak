import { Observable, ReplaySubject } from 'rxjs'

import { Injectable, Optional, SkipSelf, signal } from '@angular/core'

import { LogService } from './log.service'
import { MissionLocationType } from './mission-location.interface'
import { LOCATION_SCHEMA_VERSION, migrateLocations, normalizeLocationUids } from './mission-location-migration'
// E-122 Phase 2a: locations now live behind RecordStore (in-memory + IndexedDB) rather than
// directly in localStorage. Locations themselves aren't PII, but they share RecordStore with
// the two services that are, per the scoping pass's "all three, own key only" shape.
import { recordStore } from '../storage/record-store'

/**
 * ADR D-49: per-mission storage for named Locations (Command Post, Staging Area, Ranger
 * First Aid, ...) - the first piece of the People/Teams/Facilities split (D-45) to ship.
 *
 * Mirrors RangerService's modern parts deliberately - signal + ReplaySubject dual exposure,
 * a versioned localStorage wrapper, uid-keyed CRUD - without the legacy Excel-import cruft
 * that predates that pattern. See ranger.service.ts if a future change wants to bring the
 * two even closer together.
 */
@Injectable({ providedIn: 'root' })
export class MissionLocationService {

  private id = 'Mission Location Service'

  private locationsSignal = signal<MissionLocationType[]>([])
  private locationsReplay$ = new ReplaySubject<MissionLocationType[]>(1)
  /** Mutated in place (push/splice); updateLocalStorageAndPublish() is the single sync point. */
  private locations: MissionLocationType[] = []

  private readonly storageKey = 'locations'

  constructor(
    @Optional() @SkipSelf() existingService: MissionLocationService,
    private log: LogService,
  ) {
    if (existingService) {
      throw new Error('MissionLocationService has already been provided in the application. Avoid providing it again in child modules.')
    }

    this.loadFromLocalStorage()
    this.updateLocalStorageAndPublish()
  }

  public getLocationsObserver(): Observable<MissionLocationType[]> {
    return this.locationsReplay$.asObservable()
  }

  public getCurrentLocations(): MissionLocationType[] {
    return this.locations
  }

  private loadFromLocalStorage(): void {
    // E-122 Phase 2a: through RecordStore now - synchronous, same as localStorage.getItem().
    const stored = recordStore.getItem(this.storageKey)
    try {
      const parsed = stored != null ? JSON.parse(stored) : null
      const result = migrateLocations(parsed)
      this.locations = result.locations
      this.log.excessive(`Loaded ${this.locations.length} locations from local storage (schema v${result.schemaVersion})`, this.id)
    } catch (error: any) {
      this.locations = []
      this.log.verbose(`Unable to parse Locations from local storage. Error: ${error.message}`, this.id)
    }
  }

  private updateLocalStorageAndPublish(): void {
    // E-122 Phase 2a: through RecordStore now - synchronous to this caller, so nothing else
    // in this method changes.
    recordStore.setItem(this.storageKey,
      JSON.stringify({ schemaVersion: LOCATION_SCHEMA_VERSION, locations: this.locations }))
    // Fresh array copy for the signal - this.locations is mutated in place, so passing the
    // same reference would be a no-op under the signal's default equality check. Same
    // reasoning as RangerService's equivalent method.
    this.locationsSignal.set([...this.locations])
    this.locationsReplay$.next(this.locations)
  }

  /** Adds a new location, minting its uid. Returns the stored (uid-bearing) copy. */
  public addLocation(location: Omit<MissionLocationType, 'uid'>): MissionLocationType {
    this.locations.push({ ...location })
    const normalized = normalizeLocationUids(this.locations)
    this.locations.splice(0, this.locations.length, ...normalized)
    const added = this.locations[this.locations.length - 1]
    this.updateLocalStorageAndPublish()
    return added
  }

  /** Matches on `uid` - the surrogate key, same reasoning as RangerService.updateRanger(). */
  public updateLocation(location: MissionLocationType): void {
    const uid = String(location.uid ?? '').trim()
    if (!uid) {
      this.log.error(`updateLocation got a location with no uid (name: ${location.name})`, this.id)
      return
    }
    const index = this.locations.findIndex(l => l.uid === uid)
    if (index >= 0) {
      this.locations[index] = location
      this.updateLocalStorageAndPublish()
    } else {
      this.log.error(`updateLocation got unknown uid: ${uid}`, this.id)
    }
  }

  public deleteLocationByUid(uid: string): void {
    const index = this.locations.findIndex(l => l.uid === uid)
    if (index >= 0) {
      this.locations.splice(index, 1)
      this.updateLocalStorageAndPublish()
    } else {
      this.log.error(`deleteLocationByUid got unknown uid: ${uid}`, this.id)
    }
  }

  public deleteAllLocations(): void {
    this.locations = []
    this.updateLocalStorageAndPublish()
  }

  /** Replaces the whole list wholesale (e.g. restoring from a mission backup). */
  public replaceAllLocations(newLocations: MissionLocationType[]): void {
    this.locations = normalizeLocationUids(newLocations)
    this.updateLocalStorageAndPublish()
  }
}
