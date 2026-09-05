/**
 * Minutes before an appointment that each reminder goes out, when nothing is configured.
 *
 * The live schedule comes from `reminders.appointmentLeads` (APPOINTMENT_REMINDER_LEADS);
 * this is the fallback used when that variable is unset or unusable. Kept as the
 * documented default so the app has a sane schedule out of the box and after a bad edit.
 *
 * `0` is the appointment's own moment, not a lead at all. Keeping it in the same list
 * means the tick needs no special case for it.
 */
export const DEFAULT_APPOINTMENT_REMINDER_LEAD_MINUTES = [24 * 60, 60, 0];
