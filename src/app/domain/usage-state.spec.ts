import { DemoInputs, LIVE_WINDOW_HOURS, UsageInputs, UsageState, deriveUsageState, effectiveMode } from './usage-state'

describe('deriveUsageState (E-168)', () => {
  const HOUR = 60 * 60 * 1000
  const now = Date.UTC(2026, 9, 1, 12, 0, 0)

  const demo: DemoInputs = { loadedAt: now - HOUR, rangerUids: ['d1', 'd2'], reportIds: ['0', '1', '2'] }
  const demoReports = [{ id: '0', date: now - 5 * HOUR }, { id: '1', date: now - 4 * HOUR }, { id: '2', date: now - 3 * HOUR }]
  const longOver = { opPeriodStart: now - 40 * HOUR, opPeriodEnd: now - 30 * HOUR }

  /** A blank device, overridden per case. */
  function inputs(over: Partial<UsageInputs> = {}): UsageInputs {
    return {
      rangerUids: [], reports: [], missionName: '',
      // Fresh installs seed an op period running now; that must not read as live by itself.
      opPeriodStart: now - HOUR, opPeriodEnd: now + 11 * HOUR,
      demo: null, fieldMode: false, ...over,
    }
  }

  const cases: { name: string, input: UsageInputs, want: UsageState }[] = [
    { name: 'blank device', input: inputs(), want: 'empty' },
    { name: 'demo just loaded (op period running)', input: inputs({
      demo, missionName: 'DEMO', rangerUids: ['d1', 'd2'], reports: demoReports }), want: 'demo' },
    { name: 'demo with an emptied roster is still demo', input: inputs({ demo, reports: demoReports }), want: 'demo' },
    { name: 'real name only, op period long over', input: inputs({ missionName: '2026-10-Search', ...longOver }), want: 'setup' },
    { name: 'real roster only, op period long over', input: inputs({ rangerUids: ['r1'], ...longOver }), want: 'setup' },
    { name: 'real name and op period starting in 2 h', input: inputs({
      missionName: 'M', opPeriodStart: now + 2 * HOUR, opPeriodEnd: now + 14 * HOUR }), want: 'live' },
    { name: 'real name, op period starting in 30 h', input: inputs({
      missionName: 'M', opPeriodStart: now + 30 * HOUR, opPeriodEnd: now + 42 * HOUR }), want: 'setup' },
    { name: 'real name, op period running now', input: inputs({ missionName: 'M' }), want: 'live' },
    { name: 'real report 2 h ago, op period over', input: inputs({ reports: [{ id: '0', date: now - 2 * HOUR }], ...longOver }), want: 'live' },
    { name: 'real report just past the window', input: inputs({
      reports: [{ id: '0', date: now - (LIVE_WINDOW_HOURS + 1) * HOUR }], ...longOver }), want: 'setup' },
    { name: 'demo with a real report typed on top', input: inputs({
      demo, rangerUids: ['d1'], reports: [...demoReports, { id: '3', date: now - 10 * 60 * 1000 }] }), want: 'live' },
    { name: 'demo with a real ranger added (nothing logged)', input: inputs({
      demo, rangerUids: ['d1', 'r9'], reports: demoReports, ...longOver }), want: 'setup' },
    { name: 'demo, log cleared and restarted: a new id 0 is real by its date', input: inputs({
      demo, reports: [{ id: '0', date: now - 5 * 60 * 1000 }] }), want: 'live' },
    { name: 'old plain-string demo marker: all of it is demo', input: inputs({
      demo: { loadedAt: NaN, rangerUids: [], reportIds: [] }, rangerUids: ['x'], reports: [{ id: '0', date: now - HOUR }] }), want: 'demo' },
    { name: 'field phone mode on a blank device', input: inputs({ fieldMode: true }), want: 'live' },
    { name: 'explicit exercise with old data', input: inputs({ explicitMode: 'exercise', missionName: 'M', ...longOver }), want: 'live' },
    { name: 'explicit incident on a blank device', input: inputs({ explicitMode: 'incident' }), want: 'empty' },
    { name: 'explicit demo (restored demo backup, no marker)', input: inputs({
      explicitMode: 'demo', missionName: 'DEMO', rangerUids: ['d1'], reports: [{ id: '0', date: now - 60 * HOUR }], ...longOver }), want: 'demo' },
  ]

  for (const c of cases) {
    it(`${c.name} -> ${c.want}`, () => expect(deriveUsageState(c.input, now)).toBe(c.want))
  }

  it('effectiveMode: the choice wins, else demo when a demo is loaded, else incident', () => {
    expect(effectiveMode({ explicitMode: 'exercise', demo })).toBe('exercise')
    expect(effectiveMode({ demo })).toBe('demo')
    expect(effectiveMode({ demo: null })).toBe('incident')
  })
})
