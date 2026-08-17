import { AppointmentReminderLead } from 'src/common/enums';

/**
 * Minutes before an appointment that each reminder goes out — the single source of
 * truth for the send schedule, shared by the tick that selects targets and the
 * processor that writes the copy.
 *
 * `AT_TIME` is 0: the appointment's own moment, not a lead at all. Keeping it in the
 * same table means the tick needs no special case for it.
 *
 * Every value must be a whole number of minutes, and no two may be equal — the tick
 * claims an appointment for a lead by matching a half-open window, so identical leads
 * would send two copies of the same email.
 */
export const APPOINTMENT_REMINDER_LEAD_MINUTES: Record<AppointmentReminderLead, number> = {
  [AppointmentReminderLead.THREE_DAYS]: 3 * 24 * 60,
  [AppointmentReminderLead.ONE_HOUR]: 60,
  [AppointmentReminderLead.AT_TIME]: 0,
};
