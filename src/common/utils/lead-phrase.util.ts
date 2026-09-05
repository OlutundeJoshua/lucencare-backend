import { MINUTES_PER_DAY } from './time-label.util';

const MINUTES_PER_HOUR = 60;

/** `1 minute` / `2 minutes`, and so on for any unit. */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * How far ahead a reminder is, as the phrase its email uses: `in 30 minutes`,
 * `in 2 hours`, `tomorrow`, `now`.
 *
 * Generated from the lead rather than written per lead because the leads are now
 * configurable (APPOINTMENT_REMINDER_LEADS / MEDICATION_REMINDER_LEADS). Hand-written
 * copy keyed to a lead's name would start lying the moment someone changed its value —
 * an email headed "in 1 hour" arriving two hours early is worse than no reminder,
 * because the patient plans around it.
 *
 * `now` for zero: that lead is the appointment or dose's own moment, not a lead at all.
 */
export function formatLeadPhrase(minutes: number): string {
  if (minutes <= 0) return 'now';

  if (minutes < MINUTES_PER_HOUR) return `in ${plural(minutes, 'minute')}`;

  if (minutes < MINUTES_PER_DAY) {
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const rest = minutes % MINUTES_PER_HOUR;
    return rest === 0
      ? `in ${plural(hours, 'hour')}`
      : `in ${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
  }

  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const restHours = Math.round((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);

  // "tomorrow" reads better than "in 1 day", but only when it is exactly a day —
  // 1 day 6 hours is not tomorrow in any useful sense.
  if (days === 1 && restHours === 0) return 'tomorrow';

  return restHours === 0
    ? `in ${plural(days, 'day')}`
    : `in ${plural(days, 'day')} ${plural(restHours, 'hour')}`;
}
