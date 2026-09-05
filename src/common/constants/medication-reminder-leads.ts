import { MedicationReminderLead } from 'src/common/enums';

/**
 * Minutes before a dose that each reminder goes out — the single source of truth for
 * the medication send schedule, shared by the tick that selects targets and the
 * processor that writes the copy. The medication counterpart of
 * APPOINTMENT_REMINDER_LEAD_MINUTES, and deliberately the same shape.
 *
 * `AT_TIME` is 0: the dose's own moment, not a lead at all. Keeping it in the same
 * table means the tick needs no special case for it.
 *
 * Every value must be a whole number of minutes, none may exceed a day, and no two may
 * be equal — the tick claims a dose for a lead by matching a half-open window, so
 * identical leads would send two copies of the same email.
 *
 * COUPLED to MEDICATION_REMINDER_WINDOW_MINUTES: the gap between any two leads must
 * exceed the window, or one tick would match a dose for both at once.
 */
export const MEDICATION_REMINDER_LEAD_MINUTES: Record<MedicationReminderLead, number> = {
  [MedicationReminderLead.THIRTY_MINUTES]: 30,
  [MedicationReminderLead.AT_TIME]: 0,
};
