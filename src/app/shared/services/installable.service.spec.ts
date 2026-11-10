import { TestBed } from '@angular/core/testing'

import { InstallableService } from './installable.service'

describe('InstallableService', () => {
  let service: InstallableService

  beforeEach(() => {
    TestBed.configureTestingModule({})
    service = TestBed.inject(InstallableService)
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })
})
