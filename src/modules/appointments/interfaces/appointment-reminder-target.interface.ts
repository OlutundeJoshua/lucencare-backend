/** One appointment reminder email that is due to go out on this tick. */
export interface AppointmentReminderTarget {
  email: string;
  /** Greeting name, already reduced to the patient's first name by the service. */
  firstName: string;
  /**
   * How far ahead of the appointment this reminder is, in minutes — 0 is the
   * appointment's own moment. Carries the configured value rather than a named lead so
   * the copy can be generated from it: a name like `one_hour` would start lying the
   * moment someone changed APPOINTMENT_REMINDER_LEADS.
   */
  leadMinutes: number;
  appointmentType: string;
  appointmentDate: string;
  time: string;
  facility: string;
  provider: string;
}
