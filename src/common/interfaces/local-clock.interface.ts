/**
 * A wall-clock reading in someone's own timezone: their calendar date and how far
 * into that day they are. Everything that schedules against a stored time label is
 * anchored to this rather than to UTC — see nowInTimezone in common/utils/time-label.util.ts.
 */
export interface LocalClock {
  /** Local calendar date, `YYYY-MM-DD`. */
  dateIso: string;
  /** Minutes past local midnight. */
  minutes: number;
}
