import { provideHttpClient } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { MISSION_ZIP_SCHEMA_VERSION, MissionZipManifest, MissionZipPhoto } from '../shared/export/mission-zip'
import { MissionLocationService, MissionService, RangerService } from '../shared/services'
import { RangerPhotoService } from '../shared/services/ranger-photo.service'
import { UnknownRanger } from '../shared/services/ranger.interface'
// E-122 Phase 2a: rangers/locations now live behind RecordStore, not localStorage directly -
// see that module's own doc comment.
import { recordStore } from '../shared/storage/record-store'

import { PrepComponent } from './prep.component'

/**
 * E-109 Setup files v2 (2026-08-31, review findings R-5). Rewritten for the queue-based batch
 * apply: `pending` (one file) became `pendingQueue` (several, applied in order after one
 * confirm), rangers/locations now MERGE instead of wholesale-replace, existing photos are no
 * longer cleared first, and applying no longer auto-reloads (R-2) - `sessionLog` is this
 * component's real output now, so these specs check IT, not a since-removed alert() message.
 */
describe('PrepComponent', () => {
  let fixture: ComponentFixture<PrepComponent>
  let component: PrepComponent
  let rangerService: RangerService
  let missionService: MissionService
  let locationService: MissionLocationService
  let photos: RangerPhotoService

  const manifest = (over: Partial<MissionZipManifest> = {}): MissionZipManifest => ({
    schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
    exportedAt: '2026-08-31T00:00:00.000Z',
    appVersion: '0.90.0',
    settings: { mission: 'Applied Mission' } as any,
    rangers: [{ ...UnknownRanger, callsign: 'AP1', id: 'REW-9' }],
    locations: [{ name: 'Command Post', type: 'Command Post', lat: 47.4, lng: -122.4 }],
    ...over,
  })

  const queueOf = (m: MissionZipManifest, photos: MissionZipPhoto[] = [], filename = 'setup.zip') =>
    [{ filename, manifest: m, photos }]

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideRouter([])] })
    fixture = TestBed.createComponent(PrepComponent)
    component = fixture.componentInstance
    rangerService = TestBed.inject(RangerService)
    missionService = TestBed.inject(MissionService)
    locationService = TestBed.inject(MissionLocationService)
    photos = TestBed.inject(RangerPhotoService)
    await photos.whenReady()
    await photos.clear()
  })

  afterEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    await photos.clear()
  })

  describe('onBtnApplyQueue', () => {
    it('mutates nothing when the confirmation is cancelled, and keeps the queue for a retry', async () => {
      const before = rangerService.rangers.length
      component.pendingQueue.set(queueOf(manifest()))
      spyOn(window, 'confirm').and.returnValue(false)

      await component.onBtnApplyQueue()

      expect(rangerService.rangers.length).toBe(before)
      expect(missionService.settings.mission).not.toBe('Applied Mission')
      expect(component.pendingQueue().length).toBe(1)
      expect(component.sessionLog()).toEqual([])
    })

    it('applies settings and locations, merges rangers, and does NOT clear existing photos first', async () => {
      // A photo under a callsign this file does NOT carry - under v1's wholesale-replace this
      // would have been cleared; under additive Setup-file semantics it must survive.
      const staleFile = new File([new Blob(['stale'], { type: 'image/jpeg' })], 'STALE.jpg', { type: 'image/jpeg' })
      await photos.importFiles([staleFile], [{ callsign: 'STALE' }])
      expect(photos.photoUrl({ callsign: 'STALE' })).toContain('blob:')

      component.pendingQueue.set(queueOf(manifest(),
        [{ filename: 'REW-9.jpg', bytes: new TextEncoder().encode('new-photo-bytes') }]))
      spyOn(window, 'confirm').and.returnValue(true)
      const reloadSpy = spyOn(component, 'reloadPage')

      await component.onBtnApplyQueue()

      expect(rangerService.rangers.length).toBe(1)
      expect(rangerService.rangers[0].callsign).toBe('AP1')
      expect(missionService.settings.mission).toBe('Applied Mission')
      expect(locationService.getCurrentLocations().length).toBe(1)
      expect(locationService.getCurrentLocations()[0].name).toBe('Command Post')

      expect(photos.photoUrl({ callsign: 'STALE' })).withContext('not cleared - additive').toContain('blob:')
      expect(photos.photoUrl({ id: 'REW-9' })).toContain('blob:')

      // R-2 (review notes): no auto-reload - the session log must survive to be read.
      expect(reloadSpy).not.toHaveBeenCalled()
      expect(component.pendingQueue()).toEqual([])
      expect(component.sessionLog().length).toBe(1)
      expect(component.sessionLog()[0].filename).toBe('setup.zip')
    })

    it('merges rangers additively - an existing ranger the file does not mention survives', async () => {
      rangerService.replaceAllRangers([{ ...UnknownRanger, callsign: 'KEEP1', id: 'REW-1' }])
      component.pendingQueue.set(queueOf(manifest({
        rangers: [{ ...UnknownRanger, callsign: 'AP1', id: 'REW-9' }],
      })))
      spyOn(window, 'confirm').and.returnValue(true)

      await component.onBtnApplyQueue()

      const callsigns = rangerService.rangers.map(r => r.callsign)
      expect(callsigns).toContain('KEEP1')
      expect(callsigns).toContain('AP1')
    })

    it('leaves locations untouched when a manifest omits the key entirely (v2 presence-of-key rule)', async () => {
      // v1 used to default a MISSING locations key to [] and wholesale-replace with that empty
      // list, wiping whatever was there. v2's "presence of the key means apply it" rule (see
      // mission-zip.ts's own header comment) means an omitted key must instead mean "don't
      // touch this category at all" - this pins that this now applies to locations too, not
      // just settings/rangers.
      locationService.replaceAllLocations([{ name: 'Existing CP', type: 'Command Post', lat: 1, lng: 1 }])
      const { locations: _omitted, ...withoutLocations } = manifest()
      component.pendingQueue.set(queueOf(withoutLocations as MissionZipManifest))
      spyOn(window, 'confirm').and.returnValue(true)

      await component.onBtnApplyQueue()

      expect(locationService.getCurrentLocations().length).toBe(1)
      expect(locationService.getCurrentLocations()[0].name).toBe('Existing CP')
    })

    it('surfaces rosterWarnings for the incoming roster in that file\'s own session-log summary (R-8)', async () => {
      const withDuplicates = manifest({
        rangers: [
          { ...UnknownRanger, callsign: 'DUP', id: 'REW-1' },
          { ...UnknownRanger, callsign: 'DUP', id: 'REW-2' },
        ],
      })
      component.pendingQueue.set(queueOf(withDuplicates))
      spyOn(window, 'confirm').and.returnValue(true)

      await component.onBtnApplyQueue()

      expect(component.sessionLog()[0].summary).toContain('duplicate callsign')
      expect(component.sessionLog()[0].summary).toContain('DUP')
    })

    it('applies a multi-file batch in the given order, a later file winning on a matched row', async () => {
      const file1 = {
        filename: '01-rangers.zip',
        manifest: manifest({ rangers: [{ ...UnknownRanger, callsign: 'A1', id: 'REW-1', fullName: 'First' }] }),
        photos: [] as MissionZipPhoto[],
      }
      const file2 = {
        filename: '02-rangers.zip',
        manifest: {
          schemaVersion: MISSION_ZIP_SCHEMA_VERSION, exportedAt: '2026-08-31T00:00:00.000Z', appVersion: '0.90.0',
          rangers: [{ ...UnknownRanger, callsign: 'A1', id: 'REW-1', fullName: 'Second' }],
        } as MissionZipManifest,
        photos: [] as MissionZipPhoto[],
      }
      component.pendingQueue.set([file1, file2])
      spyOn(window, 'confirm').and.returnValue(true)

      await component.onBtnApplyQueue()

      expect(rangerService.rangers.length).toBe(1)
      expect(rangerService.rangers[0].fullName).toBe('Second')
      expect(component.sessionLog().length).toBe(2)
    })

    it('skip-and-continues past one file that fails to apply (open judgment call 4)', async () => {
      const bad = {
        schemaVersion: MISSION_ZIP_SCHEMA_VERSION, exportedAt: '2026-08-31T00:00:00.000Z', appVersion: '0.90.0',
        rangers: 'not-an-array', // forces mergeRangers()/normalizeRangerIds() to throw
      } as any as MissionZipManifest
      const good = manifest({ rangers: [{ ...UnknownRanger, callsign: 'GOOD1', id: 'REW-1' }] })
      component.pendingQueue.set([
        { filename: '01-bad.zip', manifest: bad, photos: [] },
        { filename: '02-good.zip', manifest: good, photos: [] },
      ])
      spyOn(window, 'confirm').and.returnValue(true)

      await component.onBtnApplyQueue()

      expect(rangerService.rangers.some(r => r.callsign === 'GOOD1')).toBeTrue()
      expect(component.sessionLog().length).toBe(2)
      expect(component.sessionLog()[0].summary).toContain('FAILED')
      expect(component.pendingQueue()).toEqual([])
    })

    it('does nothing and does not prompt when the queue is empty', async () => {
      const confirmSpy = spyOn(window, 'confirm')
      component.pendingQueue.set([])

      await component.onBtnApplyQueue()

      expect(confirmSpy).not.toHaveBeenCalled()
    })
  })

  describe('onRemoveQueuedFile / onClearQueue', () => {
    it('removes just the named file from the queue', () => {
      component.pendingQueue.set([
        { filename: 'a.zip', manifest: manifest(), photos: [] },
        { filename: 'b.zip', manifest: manifest(), photos: [] },
      ])
      component.onRemoveQueuedFile('a.zip')
      expect(component.pendingQueue().map(f => f.filename)).toEqual(['b.zip'])
    })

    it('clears the whole queue', () => {
      component.pendingQueue.set(queueOf(manifest()))
      component.onClearQueue()
      expect(component.pendingQueue()).toEqual([])
    })
  })
})
