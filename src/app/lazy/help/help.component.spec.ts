import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { HelpComponent } from './help.component';

describe('HelpComponent', () => {
  let component: HelpComponent;
  let fixture: ComponentFixture<HelpComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // NoopAnimations: MatTabGroup animates its body, and without this the tab panels
      // never settle in a unit test.
      imports: [HelpComponent, NoopAnimationsModule],
      // For the routerLink="/log" help link (E-57(1): Log moved off the main menu,
      // reachable from here instead).
      providers: [provideRouter([])]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(HelpComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // E-84: the page is tabs, not one long scroll. The previous test here asserted an
  // <h2>Help</h2> that the tab shell no longer has - the labels are the structure now.
  // 2026-08-29 (D-d, F29-32): "Mission setup" merged into "Start here" as one onboarding
  // checklist; FAQ moved up; "After mission" split out of "Your data"; "Log" renamed
  // "Feedback" and took over the feedback form that had briefly been on "About" - still
  // eight tabs (the merge and the split cancel out), just a different eight.
  // 2026-08-30 (live request): "Entering reports" and "Maps" moved into the Entry/Map pages'
  // own Guide drawers - they were screen-specific operating instructions, not general Help -
  // leaving six.
  it('renders the six documentation tabs, in the planned order', () => {
    const labels: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.help-nav button.help-tab') as NodeListOf<HTMLElement>
    ).map(el => el.textContent!.trim());

    expect(labels).toEqual([
      'Start here', 'FAQ', 'After mission', 'Your data', 'About', 'Contact us'
    ]);
  });

});

// 2026-10-18: rangertrak.com links to help?tab=faq#rangertrak-board and help?tab=start#field-phones.
// Both targets are collapsed sections, so landing there has to open them.
describe('HelpComponent fragments', () => {
  const open = async (tab: string, fragment: string): Promise<HTMLElement> => {
    await TestBed.configureTestingModule({
      imports: [HelpComponent, NoopAnimationsModule],
      providers: [provideRouter([]), {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap({ tab })), snapshot: { fragment } },
      }],
    }).compileComponents()
    const fixture = TestBed.createComponent(HelpComponent)
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
    await fixture.whenStable()
    await new Promise(r => setTimeout(r, 100))
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }
  const expanded = (root: HTMLElement, id: string): string | null | undefined =>
    root.querySelector(`#${id} mat-expansion-panel-header`)?.getAttribute('aria-expanded')

  it('opens the FAQ answer that #rangertrak-board names', async () => {
    const root = await open('faq', 'rangertrak-board')
    expect(root.querySelector('#rangertrak-board')).not.toBeNull()
    expect(expanded(root, 'rangertrak-board')).toBe('true')
    root.remove()
  })

  it('opens the Start-here section that #field-phones names', async () => {
    const root = await open('start', 'field-phones')
    expect(root.querySelector('#field-phones')).not.toBeNull()
    expect(expanded(root, 'field-phones')).toBe('true')
    root.remove()
  })
})
