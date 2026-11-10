import { TestBed } from '@angular/core/testing'

import { ThreeWordsService } from './three-words.service'

describe('threeWwordsService', () => {
  let service: ThreeWordsService

  beforeEach(() => {
    // ThreeWordsService is @Injectable() without providedIn: 'root' (deliberately -
    // What3Words is lazy-only, see PRIVATE-Roadmap.md D-12), so the TestBed has to
    // provide it explicitly. Without this the spec failed with NG0201.
    TestBed.configureTestingModule({ providers: [ThreeWordsService] })
    service = TestBed.inject(ThreeWordsService)
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })
})
