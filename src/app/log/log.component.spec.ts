import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { MissionJournalService } from '../shared/services/mission-journal.service'
import { recordStore } from '../shared/storage/record-store'
import { LogComponent } from './log.component'

describe('LogComponent', () => {
  let component: LogComponent
  let fixture: ComponentFixture<LogComponent>

  beforeEach(async () => {
    // Start from empty storage: specs run in random order, and one that sends feedback leaves
    // journal entries behind, which the Journal tab test would count.
    localStorage.clear()
    await recordStore.resetForTests()
    await TestBed.configureTestingModule({
      imports: [LogComponent],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /settings - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [provideRouter([])],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(LogComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  describe('Journal tab (E-222)', () => {
    async function openJournalTab(): Promise<HTMLElement> {
      const el = fixture.nativeElement as HTMLElement
      const tabs = el.querySelectorAll('[role="tab"]')
      expect(tabs.length).toBe(2)
      ;(tabs[1] as HTMLElement).click()
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
      return el
    }

    afterEach(async () => {
      localStorage.clear()
      await recordStore.resetForTests()
    })

    it('shows the check result, the entries newest first, and no clear button', async () => {
      const journal = TestBed.inject(MissionJournalService)
      journal.record('print-309', 'Printed the ICS-309 log: 4 rows.')
      journal.record('backup-exported', 'Exported a mission backup (NOT encrypted).')
      const el = await openJournalTab()

      expect(el.querySelector('[data-testid="journal-status"]')!.textContent).toMatch(
        /Journal intact: 2 entries, latest [0-9a-f]{4}…[0-9a-f]{4}/
      )
      const rows = [...el.querySelectorAll('.journal__row .journal__what')].map((r) =>
        r.textContent!.trim()
      )
      expect(rows).toEqual([
        'Exported a mission backup (NOT encrypted).',
        'Printed the ICS-309 log: 4 rows.',
      ])
      expect(el.querySelector('[data-testid="journal-export"]')).toBeTruthy()
      const buttons = [...el.querySelectorAll('.journal button')].map((b) =>
        b.textContent!.toLowerCase()
      )
      expect(buttons.some((t) => t.includes('clear') || t.includes('delete'))).toBe(false)
    })

    it('says where the chain is broken', async () => {
      const journal = TestBed.inject(MissionJournalService)
      journal.record('print-309', 'one')
      journal.record('print-309', 'two')
      const stored = JSON.parse(recordStore.getItem('missionJournal')!)
      stored.entries[0].summary = 'edited'
      recordStore.setItem('missionJournal', JSON.stringify(stored))
      TestBed.resetTestingModule()
      TestBed.configureTestingModule({
        imports: [LogComponent],
        providers: [provideRouter([])],
      })
      fixture = TestBed.createComponent(LogComponent)
      fixture.detectChanges()
      const el = await openJournalTab()
      expect(el.querySelector('[data-testid="journal-status"]')!.textContent).toContain(
        'Journal broken at entry 1'
      )
    })
  })
})
