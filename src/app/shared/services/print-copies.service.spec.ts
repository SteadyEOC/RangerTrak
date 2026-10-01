import { TestBed } from '@angular/core/testing'
import { MissionService } from './mission.service'
import { PrintCopiesService } from './print-copies.service'

describe('PrintCopiesService (E-150)', () => {
  it('clampExtra keeps 0-9, floors, and falls back to 1 for junk', () => {
    expect(PrintCopiesService.clampExtra(-3)).toBe(0)
    expect(PrintCopiesService.clampExtra(4.9)).toBe(4)
    expect(PrintCopiesService.clampExtra(12)).toBe(9)
    expect(PrintCopiesService.clampExtra(NaN)).toBe(1)
    expect(PrintCopiesService.clampExtra('x' as unknown as number)).toBe(1)
  })

  it('reads the saved mission value and totals it with the form itself', () => {
    const mission = TestBed.inject(MissionService)
    const svc = TestBed.inject(PrintCopiesService)
    mission.updateMission({ ...mission.initMission(), extraCopies213: 3 })
    expect(svc.extraCopies()).toBe(3)
    expect(svc.totalCopies()).toBe(4)
    mission.updateMission({ ...mission.initMission(), extraCopies213: 0 })
    expect(svc.totalCopies()).toBe(1)
    mission.updateMission({ ...mission.initMission(), extraCopies213: 99 })
    expect(svc.extraCopies()).toBe(9)
  })
})
