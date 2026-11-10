import { provideHttpClient } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'

import { provideSwUpdateStub } from '../../../testing/sw-update.stub'
import { FooterComponent } from './footer.component'

describe('FooterComponent', () => {
  let component: FooterComponent
  let fixture: ComponentFixture<FooterComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterComponent],
      // The footer reads UpdateService for the "new version ready" indicator,
      // which needs SwUpdate present even though it stays disabled here.
      providers: [provideHttpClient(), provideSwUpdateStub()],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(FooterComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })
})
