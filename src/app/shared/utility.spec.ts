import { Utility } from './utility';

// Utility is all static functions - no instance/TestBed needed.
describe('Utility', () => {

  describe('timeDiff', () => {
    it('computes days/hours/minutes/seconds between two timestamps', () => {
      const start = Date.UTC(2026, 0, 1, 0, 0, 0);
      const end = Date.UTC(2026, 0, 2, 3, 4, 5); // +1d 3h 4m 5s

      const diff = Utility.timeDiff(start, end);

      expect(diff.negative).toBeFalse();
      expect(diff.days).toBe(1);
      expect(diff.hours).toBe(3);
      expect(diff.minutes).toBe(4);
      expect(diff.seconds).toBe(5);
    });

    it('flags a negative interval when endTime precedes startTime', () => {
      const start = Date.UTC(2026, 0, 2, 0, 0, 0);
      const end = Date.UTC(2026, 0, 1, 18, 0, 0); // 6h before start (18:00 -> midnight)

      const diff = Utility.timeDiff(start, end);

      expect(diff.negative).toBeTrue();
      expect(diff.days).toBe(0);
      expect(diff.hours).toBe(6);
      expect(diff.minutes).toBe(0);
      expect(diff.seconds).toBe(0);
    });
  });

  describe('isReportTimeInFuture', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    it('is false for a time in the past', () => {
      expect(Utility.isReportTimeInFuture(Date.UTC(2026, 0, 1, 11, 0, 0), now)).toBeFalse();
    });

    it('is false for the current moment', () => {
      expect(Utility.isReportTimeInFuture(now, now)).toBeFalse();
    });

    it('is false for a few minutes in the future, within the default 5-minute threshold', () => {
      expect(Utility.isReportTimeInFuture(Date.UTC(2026, 0, 1, 12, 4, 59), now)).toBeFalse();
    });

    it('is true just past the default 5-minute threshold', () => {
      expect(Utility.isReportTimeInFuture(Date.UTC(2026, 0, 1, 12, 5, 1), now)).toBeTrue();
    });

    it('is true for an hour in the future - the reported live symptom', () => {
      expect(Utility.isReportTimeInFuture(Date.UTC(2026, 0, 1, 13, 0, 0), now)).toBeTrue();
    });

    it('honors a custom threshold', () => {
      const tenMinAhead = Date.UTC(2026, 0, 1, 12, 10, 0);
      expect(Utility.isReportTimeInFuture(tenMinAhead, now, 5)).toBeTrue();
      expect(Utility.isReportTimeInFuture(tenMinAhead, now, 15)).toBeFalse();
    });

    it('accepts an ISO string the same way settings round-trip through localStorage', () => {
      expect(Utility.isReportTimeInFuture('2026-01-01T13:00:00.000Z', now)).toBeTrue();
    });

    it('is false, not throwing, for an unparsable value', () => {
      expect(Utility.isReportTimeInFuture('not a date', now)).toBeFalse();
    });
  });

  describe('zeroFill', () => {
    it('left-pads a number to the requested width', () => {
      expect(Utility.zeroFill(5, 2)).toBe('05');
      expect(Utility.zeroFill(42, 4)).toBe('0042');
    });

    it('does not truncate a number already at or beyond the requested width', () => {
      expect(Utility.zeroFill(12345, 2)).toBe('12345');
    });
  });

  describe('isDark', () => {
    it('treats a light hex color as not dark (YIQ >= 128)', () => {
      expect(Utility.isDark('ffffff')).toBeTrue();
    });

    it('treats a dark hex color as dark (YIQ < 128)', () => {
      expect(Utility.isDark('000000')).toBeFalse();
    });
  });
});
