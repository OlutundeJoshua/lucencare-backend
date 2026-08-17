export interface ReminderTarget {
  email: string;
  /** Greeting name, already reduced to the patient's first name by the service. */
  firstName: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  /** Consecutive fully-completed days, as shown in the reminder's nudge line. */
  streakDays: number;
}
