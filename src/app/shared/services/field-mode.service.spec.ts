import { TestBed } from '@angular/core/testing';

import { FieldModeService } from './field-mode.service';

describe('FieldModeService', () => {
  let service: FieldModeService;

  beforeEach(() => {
    localStorage.removeItem('fieldModeSentUids');
    service = TestBed.inject(FieldModeService);
  });

  afterEach(() => localStorage.removeItem('fieldModeSentUids'));

  it('counts reports not yet in a Report Packet, and reports with no uid as unsent', () => {
    service.markSent(['a']);
    expect(service.unsentCount([{ uid: 'a' }, { uid: 'b' }, {}])).toBe(2);
  });

  // 2026-10-28, John: a phone with unsent reports warns before leaving field mode.
  it('names the unsent reports in the leave prompt, and does nothing on Cancel', () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    const disableSpy = spyOn(service, 'disable');

    service.confirmAndTurnOff(5);
    expect(confirmSpy.calls.mostRecent().args[0]).toContain('5 reports on this phone have not been sent yet');

    service.confirmAndTurnOff(1);
    expect(confirmSpy.calls.mostRecent().args[0]).toContain('1 report on this phone has not been sent yet');

    service.confirmAndTurnOff(0);
    expect(confirmSpy.calls.mostRecent().args[0]).not.toContain('not been sent');
    expect(disableSpy).not.toHaveBeenCalled();
  });
});
