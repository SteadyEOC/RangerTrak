import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RangersComponent } from './rangers.component';
import { RangerService, RangerType } from '../shared/services';

describe('RangersComponent', () => {
  let component: RangersComponent;
  let fixture: ComponentFixture<RangersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ RangersComponent ],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /settings - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [ provideRouter([]) ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(RangersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * 2026-09-28, John (item 6): the Rangers grid used to require a separate "Save edits"
   * button - onCellValueChanged now saves automatically, the same pattern
   * radio-log.component.ts's own gridOptions already uses.
   */
  it('saves automatically on a committed cell edit, the same as the Radio Log grid', () => {
    const rangerService = TestBed.inject(RangerService);
    const saveSpy = spyOn(rangerService, 'updateLocalStorageAndPublish');

    component.gridOptions.onCellValueChanged?.({} as any);

    expect(saveSpy).toHaveBeenCalled();
  });

  /**
   * 2026-09-28, John (item 5b): "clicked Add Ranger and got a new row on the LAST page ...
   * while the grid stayed on page 1" traced to onBtnAddRanger() calling reloadPage() (a full
   * window.location.reload()) after adding ONE row - a fresh grid always starts on page 1,
   * which was the actual "stayed on page 1" bug. Reload is gone; this guards against it
   * coming back.
   */
  it('adding a ranger no longer reloads the whole page', () => {
    // window.location.reload isn't spy-able directly in this Karma/Chrome setup ("reload is
    // not declared writable or has no setter") - reloadPage() is this component's own single
    // choke point for it (every OTHER reload call site already goes through it too), so
    // spying on that is the equivalent, spy-able check.
    const reloadSpy = spyOn(component, 'reloadPage');
    // A minimal stand-in for AG Grid's api - onBtnAddRanger()/focusNewRangerRow() call a
    // handful of methods on it; every one is a no-op here since this test only cares that
    // reloadPage() is never reached, not that the grid actually re-paints in Karma.
    (component as any).gridApi = {
      setGridOption: () => { },
      refreshCells: () => { },
      autoSizeAllColumns: () => { },
      forEachNodeAfterFilterAndSort: () => { },
      paginationGetPageSize: () => 20,
      paginationGoToPage: () => { },
      ensureIndexVisible: () => { },
      getDisplayedRowAtIndex: () => null,
      setFocusedCell: () => { },
      startEditingCell: () => { },
    };

    component.onBtnAddRanger();

    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
