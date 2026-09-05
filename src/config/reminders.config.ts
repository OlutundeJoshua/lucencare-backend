import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

import { DEFAULT_APPOINTMENT_REMINDER_LEAD_MINUTES } from 'src/common/constants/appointment-reminder-leads';
import { DEFAULT_MEDICATION_REMINDER_LEAD_MINUTES } from 'src/common/constants/medication-reminder-leads';
import { MINUTES_PER_DAY } from 'src/common/utils/time-label.util';

const logger = new Logger('RemindersConfig');

/**
 * How a lead schedule is written in the environment: whole minutes before the event,
 * comma-separated, in any order. `0` is the event's own moment.
 *
 *   APPOINTMENT_REMINDER_LEADS=1440,60,0   a day, an hour, and on time
 *   MEDICATION_REMINDER_LEADS=30,0         half an hour, and on time
 *
 * Unset falls back to the defaults above. Explicitly empty means no reminders at all —
 * that is a deliberate distinction, so turning reminders off is possible without a
 * deploy and is never confused with forgetting to set the variable.
 */
export function parseLeadSchedule(
  raw: string | undefined,
  fallback: number[],
  { name, windowMinutes, maxMinutes }: LeadScheduleRules,
): number[] {
  if (raw === undefined) return sortedDesc(fallback);

  const trimmed = raw.trim();
  // Explicitly empty: every reminder on this schedule is off.
  if (trimmed === '') {
    logger.warn(`${name} is empty — all reminders on this schedule are disabled.`);
    return [];
  }

  const parts = trimmed.split(',').map((p) => p.trim());
  const minutes: number[] = [];

  for (const part of parts) {
    // Deliberately strict: Number('') is 0 and Number('6O') is NaN, and a schedule that
    // quietly reinterprets a typo is how a reminder goes missing for weeks.
    if (!/^\d+$/.test(part)) {
      return reject(name, `"${part}" is not a whole number of minutes`, fallback);
    }
    minutes.push(Number(part));
  }

  if (new Set(minutes).size !== minutes.length) {
    return reject(name, 'it repeats a lead, which would send the same email twice', fallback);
  }

  const tooFar = minutes.find((m) => m > maxMinutes);
  if (tooFar !== undefined) {
    return reject(name, `${tooFar} exceeds the ${maxMinutes}-minute maximum`, fallback);
  }

  // Two leads closer together than the window are both matched by a single tick, so
  // the patient gets two copies of the same reminder at once.
  const sorted = sortedDesc(minutes);
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i] - sorted[i + 1];
    if (gap <= windowMinutes) {
      return reject(
        name,
        `leads ${sorted[i]} and ${sorted[i + 1]} are ${gap} minutes apart, which is not more than the ${windowMinutes}-minute tick window — one tick would match both`,
        fallback,
      );
    }
  }

  return sorted;
}

/** Furthest lead first, so a caller reading the schedule sees it in the order it fires. */
function sortedDesc(minutes: number[]): number[] {
  return [...minutes].sort((a, b) => b - a);
}

/**
 * Falls back to the built-in schedule rather than booting with no reminders or
 * crashing the API. A malformed reminder variable must not take down login.
 */
function reject(name: string, reason: string, fallback: number[]): number[] {
  logger.error(
    `${name} is invalid — ${reason}. Falling back to the default schedule [${fallback.join(', ')}].`,
  );
  return sortedDesc(fallback);
}

interface LeadScheduleRules {
  name: string;
  /** The tick window this schedule is matched against — leads must be further apart. */
  windowMinutes: number;
  maxMinutes: number;
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default registerAs('reminders', () => ({
  appointmentLeads: parseLeadSchedule(
    process.env.APPOINTMENT_REMINDER_LEADS,
    DEFAULT_APPOINTMENT_REMINDER_LEAD_MINUTES,
    {
      name: 'APPOINTMENT_REMINDER_LEADS',
      windowMinutes: positiveInt(process.env.APPOINTMENT_REMINDER_WINDOW_MINUTES, 5),
      // 30 days out. Beyond that a reminder is noise, and the scan horizon it drives
      // would select most of the appointments table on every tick.
      maxMinutes: 30 * MINUTES_PER_DAY,
    },
  ),

  medicationLeads: parseLeadSchedule(
    process.env.MEDICATION_REMINDER_LEADS,
    DEFAULT_MEDICATION_REMINDER_LEAD_MINUTES,
    {
      name: 'MEDICATION_REMINDER_LEADS',
      windowMinutes: positiveInt(process.env.MEDICATION_REMINDER_WINDOW_MINUTES, 5),
      // A dose repeats daily, so a lead of a full day or more would wrap onto the
      // previous occurrence and fire at the wrong time entirely.
      maxMinutes: MINUTES_PER_DAY - 1,
    },
  ),
}));
