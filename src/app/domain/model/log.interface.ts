export enum LogLevel { Excessive, Verbose, Info, Warn, Error }

/** Human-readable names, indexed by LogLevel - for display and CSV export. */
export const LogLevelNames = ['Excessive', 'Verbose', 'Info', 'Warn', 'Error']

export type LogType = {
  /**
   * Monotonic sequence number, matching the prefix written to the browser console so an
   * entry can be correlated between the two. Also the stable `track` key for the Log
   * page - an array index would be wrong, since the oldest entries are discarded once
   * the buffer is full.
   */
  id: number,
  date: Date,
  msg: string,
  level: LogLevel,
  source: string
}
export const LogHeadings = ["Id", "Date", "Level", "Source", "Message"]
