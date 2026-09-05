import { MedicationReminderLead } from 'src/common/enums';

import { ReminderMedication } from './reminder-medication.interface';

/**
 * One medication reminder email. Grouped by patient, lead and slot rather than by
 * medication: a patient on three medications at 8:00 AM used to receive three separate
 * emails, and with two leads that would have become six a day for one slot.
 */
export interface ReminderTarget {
  email: string;
  /** Greeting name, already reduced to the patient's first name by the service. */
  firstName: string;
  /** Which of the scheduled reminders this is — it picks the copy. */
  lead: MedicationReminderLead;
  /**
   * The slot, normalised for display ('8:00 AM'). Several labels can name the same
   * moment ('8:00 AM' and 'Monday · 8:00 AM'), and they share one email.
   */
  scheduledTime: string;
  /** Every medication the patient has due in this slot and has not already resolved. */
  medications: ReminderMedication[];
  /** Consecutive fully-completed days, as shown in the reminder's nudge line. */
  streakDays: number;
}
