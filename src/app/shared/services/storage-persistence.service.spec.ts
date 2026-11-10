import { TestBed } from '@angular/core/testing'

import { StoragePersistenceService } from './storage-persistence.service'

describe('StoragePersistenceService', () => {
  afterEach(() => {
    // Restore whatever the real browser's navigator.storage looked like,
    // in case a test replaced it.
    TestBed.resetTestingModule()
  })

  describe('when the browser supports the Storage API', () => {
    it('reflects the current persisted() state on construction', async () => {
      vi.spyOn(navigator.storage, 'persisted').mockResolvedValue(true)

      const service = TestBed.inject(StoragePersistenceService)
      await Promise.resolve() // let the constructor's async refreshStatus() settle
      await Promise.resolve()

      expect(service.persisted()).toBe(true)
    })

    it('requestPersistence() calls navigator.storage.persist() and updates the signal', async () => {
      vi.spyOn(navigator.storage, 'persisted').mockResolvedValue(false)
      const persistSpy = vi.spyOn(navigator.storage, 'persist').mockResolvedValue(true)

      const service = TestBed.inject(StoragePersistenceService)
      const granted = await service.requestPersistence()

      expect(persistSpy).toHaveBeenCalled()
      expect(granted).toBe(true)
      expect(service.persisted()).toBe(true)
    })

    it('reflects a denied request', async () => {
      vi.spyOn(navigator.storage, 'persisted').mockResolvedValue(false)
      vi.spyOn(navigator.storage, 'persist').mockResolvedValue(false)

      const service = TestBed.inject(StoragePersistenceService)
      const granted = await service.requestPersistence()

      expect(granted).toBe(false)
      expect(service.persisted()).toBe(false)
    })
  })

  describe('when the browser does not support the Storage API', () => {
    it('reports null (unsupported) rather than throwing', async () => {
      const originalStorage = navigator.storage
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        configurable: true,
      })

      const service = TestBed.inject(StoragePersistenceService)
      const granted = await service.requestPersistence()

      expect(granted).toBe(false)
      expect(service.persisted()).toBeNull()

      Object.defineProperty(navigator, 'storage', {
        value: originalStorage,
        configurable: true,
      })
    })
  })
})
