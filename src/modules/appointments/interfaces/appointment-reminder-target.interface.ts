import { AppointmentReminderLead } from 'src/common/enums';

/** One appointment reminder email that is due to go out on this tick. */
export interface AppointmentReminderTarget {
  email: string;
  /** Greeting name, already reduced to the patient's first name by the service. */
  firstName: string;
  /** Which of the scheduled reminders this is — it picks the copy. */
  lead: AppointmentReminderLead;
  appointmentType: string;
  appointmentDate: string;
  time: string;
  facility: string;
  provider: string;
}
