import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NavigationEnd, NavigationStart, Router } from '@angular/router'
import { RouterTestingModule } from '@angular/router/testing'
import { Subject } from 'rxjs'

import { provideSwUpdateStub } from '../../../testing/sw-update.stub'
import { FieldModeService } from '../services/field-mode.service'
import { NavbarComponent } from './navbar.component'

describe('NavbarComponent', () => {
  let component: NavbarComponent
  let fixture: ComponentFixture<NavbarComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // The navbar's routerLink/routerLinkActive directives inject ActivatedRoute,
      // which only exists once a router is configured - NG0201 without this.
      imports: [RouterTestingModule, NavbarComponent],
      // E-55: the navbar now renders InstallUpdateComponent, which injects UpdateService,
      // which needs SwUpdate present even though it stays disabled here (same reasoning as
      // footer.component.spec.ts).
      providers: [provideSwUpdateStub()],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(NavbarComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  // E-57(1): "Rename the About page to Help... but not link to Log from the main menu.
  // Too many confusing things are on the main menu!"
  it('says Help, not About, and has no Log item', () => {
    const labels = [
      ...fixture.nativeElement.querySelectorAll('.main-nav > ul > li > a'),
    ].map((a: HTMLAnchorElement) => a.textContent?.trim())
    expect(labels).toContain('Help')
    expect(labels).not.toContain('About')
    expect(labels).not.toContain('Log')
  })

  // E-63b: "why is there still a 'Home' button on the top navbar? It was supposed to be
  // replaced with the RangerTrak(tm) service mark."
  it('has no separate Home nav item - the brand mark is the Home link', () => {
    const labels = [
      ...fixture.nativeElement.querySelectorAll('.main-nav > ul > li > a'),
    ].map((a: HTMLAnchorElement) => a.textContent?.trim())
    expect(labels).not.toContain('Home')

    const brand: HTMLAnchorElement = fixture.nativeElement.querySelector('a.brand')
    expect(brand).not.toBeNull()
    expect(brand.getAttribute('href')).toBe('/')
    expect(brand.querySelector('svg.brand-icon')).not.toBeNull()
  })

  // 2026-10-28, John: "I'm in field phone mode & don't see the get out of it button".
  it("a field phone's menu has Leave field mode; the full app's does not", () => {
    const q = () =>
      fixture.nativeElement.querySelector('[data-testid="nav-leave-field-mode"]')
    expect(q()).toBeNull()

    const fieldMode = TestBed.inject(FieldModeService)
    fieldMode.enabled.set(true)
    fixture.detectChanges()
    const spy = vi.spyOn(fieldMode, 'confirmAndTurnOff').mockReturnValue(undefined)
    ;(q() as HTMLButtonElement).click()
    expect(spy).toHaveBeenCalled()
    fieldMode.enabled.set(false)
  })

  // E-309: an installed app has no browser reload button, so a page that never finishes loading needs one.
  describe('Still loading? Reload', () => {
    const events = () => TestBed.inject(Router).events as unknown as Subject<unknown>
    const button = () => fixture.nativeElement.querySelector('[data-testid="nav-reload"]') as HTMLButtonElement | null
    const isHidden = () => button()!.classList.contains('Navbar__reload--hidden')

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('is in the layout from the start of a navigation but only shown after the delay', () => {
      events().next(new NavigationStart(1, '/map'))
      fixture.detectChanges()
      expect(button()).not.toBeNull()
      expect(isHidden()).toBe(true) // space reserved, nothing moves when it appears

      vi.advanceTimersByTime(NavbarComponent.RELOAD_DELAY_MS - 1)
      fixture.detectChanges()
      expect(isHidden()).toBe(true)

      vi.advanceTimersByTime(1)
      fixture.detectChanges()
      expect(isHidden()).toBe(false)
      expect(button()!.textContent).toContain('Still loading? Reload')
    })

    it('never appears when the page loads in time', () => {
      events().next(new NavigationStart(1, '/map'))
      vi.advanceTimersByTime(1000)
      events().next(new NavigationEnd(1, '/map', '/map'))
      vi.advanceTimersByTime(NavbarComponent.RELOAD_DELAY_MS * 2)
      fixture.detectChanges()
      expect(component.showReload()).toBe(false)
      expect(button()).toBeNull()
    })

    it('reloads the page when pressed', () => {
      events().next(new NavigationStart(1, '/map'))
      vi.advanceTimersByTime(NavbarComponent.RELOAD_DELAY_MS)
      fixture.detectChanges()
      const spy = vi.spyOn(component, 'reload').mockReturnValue(undefined)
      button()!.click()
      expect(spy).toHaveBeenCalled()
    })
  })
})

describe('isChunkLoadFailure (E-309)', () => {
  it('knows the browsers\' wordings for a lazy page that could not load', async () => {
    const { isChunkLoadFailure } = await import('./navbar.component')
    expect(isChunkLoadFailure('Failed to fetch dynamically imported module: https://x/chunk-ABC.js')).toBe(true)
    expect(isChunkLoadFailure('Importing a module script failed.')).toBe(true)
    expect(isChunkLoadFailure('error loading dynamically imported module')).toBe(true)
    expect(isChunkLoadFailure('Cannot read properties of undefined')).toBe(false)
  })
})
