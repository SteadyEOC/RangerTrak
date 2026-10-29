import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { FilterChipsComponent } from './filter-chips.component'

describe('FilterChipsComponent', () => {
  let fixture: ComponentFixture<FilterChipsComponent>
  const el = () => fixture.nativeElement as HTMLElement

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterChipsComponent], providers: [provideNoopAnimations()] }).compileComponents()
    fixture = TestBed.createComponent(FilterChipsComponent)
  })

  it('renders nothing with no chips', () => {
    fixture.detectChanges()
    expect(el().querySelector('mat-chip')).toBeNull()
    expect(el().querySelector('.filter-chips')).toBeNull()
    expect(el().textContent?.trim()).toBe('')
  })

  it('shows a chip per filter and emits clear with its key', () => {
    fixture.componentRef.setInput('chips', [{ key: 'team', label: 'Team: CERT' }, { key: 'status', label: 'Status: Urgent' }])
    fixture.detectChanges()
    expect(el().querySelectorAll('mat-chip').length).toBe(2)
    let cleared = ''
    fixture.componentInstance.clear.subscribe(k => cleared = k)
    const x = el().querySelector('button[aria-label="Remove filter: Status: Urgent"]') as HTMLButtonElement
    expect(x).not.toBeNull()
    x.click()
    expect(cleared).toBe('status')
  })

  it('emits clearAll from Show everything', () => {
    fixture.componentRef.setInput('chips', [{ key: 'team', label: 'Team: CERT' }])
    fixture.detectChanges()
    let n = 0
    fixture.componentInstance.clearAll.subscribe(() => n++)
    ;(el().querySelector('.filter-chips__all') as HTMLButtonElement).click()
    expect(n).toBe(1)
  })

  it('E-234: shows an off-by-default toggle with no chips, and emits toggle when picked', () => {
    fixture.componentRef.setInput('toggleLabel', 'Current op period (OP 3)')
    fixture.detectChanges()
    expect(el().querySelector('.filter-chips__lead')).toBeNull()
    expect(el().querySelector('.filter-chips__all')).toBeNull()
    const opt = el().querySelector('mat-chip-option') as HTMLElement
    expect(opt.textContent).toContain('Current op period (OP 3)')
    let n = 0
    fixture.componentInstance.toggle.subscribe(() => n++)
    ;(opt.querySelector('.mdc-evolution-chip__action') as HTMLElement).click()
    expect(n).toBe(1)
  })
})
