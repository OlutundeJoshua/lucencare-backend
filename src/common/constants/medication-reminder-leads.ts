/**
 * Minutes before a dose that each reminder goes out, when nothing is configured.
 *
 * The live schedule comes from `reminders.medicationLeads` (MEDICATION_REMINDER_LEADS);
 * this is the fallback used when that variable is unset or unusable.
 *
 * A dose is a time of day that repeats, so every medication lead must be under a full
 * day — a lead of 1440 or more would wrap onto the previous occurrence.
 */
export const DEFAULT_MEDICATION_REMINDER_LEAD_MINUTES = [30, 0];
