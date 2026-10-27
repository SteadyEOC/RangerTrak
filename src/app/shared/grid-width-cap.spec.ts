import { capColumnWidths, ColumnWidth } from './grid-width-cap';

const col = (id: string, width: number, minWidth = 60, fixed = false): ColumnWidth => ({ id, width, minWidth, fixed });

describe('capColumnWidths', () => {
  it('changes nothing when the grid already fits', () => {
    expect(capColumnWidths([col('a', 100), col('b', 200)], 300)).toEqual({});
  });

  it('shrinks only the widest columns, to one ceiling, down to the limit', () => {
    const out = capColumnWidths([col('lat', 90), col('address', 420), col('to', 300)], 600);
    expect(out['lat']).toBeUndefined();
    expect(out['address']).toBe(out['to']);
    expect(90 + out['address'] + out['to']).toBeLessThanOrEqual(600);
    expect(90 + out['address'] + out['to']).toBeGreaterThan(595);
  });

  it('never goes below a column minWidth and leaves a flex column alone', () => {
    const out = capColumnWidths([col('status', 220, 130), col('notes', 260, 260, true), col('to', 300)], 400);
    expect(out['status']).toBe(130);
    expect(out['notes']).toBeUndefined();
    expect(out['to']).toBe(60);
  });
});
