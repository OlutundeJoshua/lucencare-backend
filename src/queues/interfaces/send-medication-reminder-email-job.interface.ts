import { ReminderTarget } from 'src/modules/medications/interfaces/reminder-target.interface';

export interface SendMedicationReminderEmailJob {
  targets: ReminderTarget[];
}
