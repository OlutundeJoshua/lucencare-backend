import { ParsedTimeLabel } from 'src/common/interfaces/parsed-time-label.interface';
import { LocalClock } from 'src/common/interfaces/local-clock.interface';

/**
 * A user-facing time label: a 12-hour clock time, optionally prefixed with a weekday
 * for weekly items — `'8:00 AM'`, `'Monday · 8:00 AM'`, `'10:30 AM'`.
 *
 * Both `medications.schedule_times` and `appointments.time` are free-form display
 * strings rather than time columns, so this one pattern reads both. Anything that
 * schedules off a stored label must parse it here and nowhere else — two regexes that
 * disagree on what `'8:00 AM'` means is exactly the drift that silently drops reminders.
 */
const TIME_LABEL_PATTERN = /^(?:([A-Za-z]+)\s*·\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

export const MINUTES_PER_DAY = 1440;

/**
 * Minutes past local midnight for a time label, plus the weekday it names if any.
 * Returns undefined for a label it cannot read — every caller treats that as "skip",
 * never as an error, so one malformed row never breaks a whole schedule or batch.
 */
export function parseTimeLabel(label: string): ParsedTimeLabel | undefined {
  const match = TIME_LABEL_PATTERN.exec(label.trim());
  if (!match) return undefined;

  let hour = Number(match[2]) % 12;
  if (match[4].toUpperCase() === 'PM') hour += 12;
  return { minutes: hour * 60 + Number(match[3]), weekday: match[1] };
}

/**
 * The wall clock in a given IANA timezone: the local calendar date and minutes past
 * local midnight. Returns undefined for a timezone string Intl rejects.
 *
 * Reminders are anchored to this rather than to UTC because zones offset by 30 or 45
 * minutes (Asia/Kolkata, Asia/Kathmandu) never line up with a tick computed from UTC.
 */
export function nowInTimezone(now: Date, timezone: string): LocalClock | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    if (!year || !month || !day || !hour || !minute) return undefined;
    return { dateIso: `${year}-${month}-${day}`, minutes: Number(hour) * 60 + Number(minute) };
  } catch {
    return undefined;
  }
}

/** Full weekday name for a plain ISO date, read in UTC so no timezone shifts it. */
export function weekdayForIsoDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

/** True when a parsed label applies on the given date — always, unless it names a day. */
export function appliesOnDate(parsed: ParsedTimeLabel, dateIso: string): boolean {
  if (!parsed.weekday) return true;
  return parsed.weekday.toLowerCase() === weekdayForIsoDate(dateIso).toLowerCase();
}

/**
 * Whole days from `fromIso` to `toIso`. Both dates are read at UTC midnight so no
 * timezone shifts the count — these are plain calendar dates, not instants.
 * Returns undefined if either date is unreadable.
 */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number | undefined {
  const diff = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(diff)) return undefined;
  return Math.round(diff / 86_400_000);
}

/**
 * Minutes from `local` until a scheduled moment. Positive while it is still ahead,
 * negative once it has passed — the mirror image of "minutes elapsed since".
 * Returns undefined when the label is unreadable or does not apply on that date.
 */
export function minutesUntilScheduled(
  dateIso: string,
  timeLabel: string,
  local: LocalClock | undefined,
): number | undefined {
  if (!local) return undefined;

  const parsed = parseTimeLabel(timeLabel);
  if (!parsed || !appliesOnDate(parsed, dateIso)) return undefined;

  const dayDiff = daysBetweenIsoDates(local.dateIso, dateIso);
  if (dayDiff === undefined) return undefined;

  return dayDiff * MINUTES_PER_DAY + (parsed.minutes - local.minutes);
}
