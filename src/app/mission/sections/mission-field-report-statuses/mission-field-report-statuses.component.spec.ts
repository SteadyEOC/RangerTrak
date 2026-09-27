import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MissionFieldReportStatusesComponent } from './mission-field-report-statuses.component';
import { RadioLogService } from '../../../shared/services/';

describe('MissionFieldReportStatusesComponent', () => {
  let component: MissionFieldReportStatusesComponent;
  let fixture: ComponentFixture<MissionFieldReportStatusesComponent>;
  let radioLogService: RadioLogService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionFieldReportStatusesComponent],
      providers: [provideHttpClient()],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MissionFieldReportStatusesComponent);
    component = fixture.componentInstance;
    component.rowData = [{ status: 'Normal', color: 'normal', icon: '' }];
    radioLogService = TestBed.inject(RadioLogService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('isStatusInUse (E-73)', () => {
    it('is false when no radio log entry carries the status', () => {
      radioLogService.replaceAllRadioLog({
        version: '1', date: new Date(), event: '', numReport: 0, maxId: 0, filter: '',
        logEntries: [],
      });

      expect(component.isStatusInUse('Normal')).toBe(false);
    });

    it('is true when a radio log entry carries the exact status name', () => {
      radioLogService.replaceAllRadioLog({
        version: '1', date: new Date(), event: '', numReport: 1, maxId: 1, filter: '',
        logEntries: [{
          id: 1, callsign: 'E2E-AA1', location: { lat: 47.4, lng: -122.4 } as any,
          date: new Date(), status: 'Normal', notes: '',
        }],
      });

      expect(component.isStatusInUse('Normal')).toBe(true);
      expect(component.isStatusInUse('Urgent')).toBe(false);
    });
  });

  describe('Status column gating (E-73)', () => {
    it('is not editable for a status already in use', () => {
      radioLogService.replaceAllRadioLog({
        version: '1', date: new Date(), event: '', numReport: 1, maxId: 1, filter: '',
        logEntries: [{
          id: 1, callsign: 'E2E-AA1', location: { lat: 47.4, lng: -122.4 } as any,
          date: new Date(), status: 'Normal', notes: '',
        }],
      });

      const statusCol = component.columnDefs.find(c => c.field === 'status') as any;
      expect(statusCol.editable({ data: { status: 'Normal' } })).toBe(false);
    });

    it('stays editable for a status not yet used', () => {
      radioLogService.replaceAllRadioLog({
        version: '1', date: new Date(), event: '', numReport: 0, maxId: 0, filter: '',
        logEntries: [],
      });

      const statusCol = component.columnDefs.find(c => c.field === 'status') as any;
      expect(statusCol.editable({ data: { status: 'Normal' } })).toBe(true);
    });
  });
});
