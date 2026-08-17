import { AppointmentReminderTarget } from 'src/modules/appointments/interfaces/appointment-reminder-target.interface';

export interface SendAppointmentReminderJob {
  targets: AppointmentReminderTarget[];
}
