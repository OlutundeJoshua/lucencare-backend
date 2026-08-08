/**
 * A `scheduleTimes` entry broken into its parts.
 *
 * Entries are 12-hour display labels as the patient chose them — `'8:00 AM'`, or
 * `'Monday · 8:00 AM'` for a weekly medication. `weekday` is present only for the
 * latter, and constrains the dose to that day.
 */
export interface ParsedDoseTime {
  /** Minutes since local midnight, for window and due-now comparisons. */
  minutes: number;
  /** Full day name as stored, e.g. 'Monday'. Absent for daily schedules. */
  weekday?: string;
}
