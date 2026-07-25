import { DoseStatus } from 'src/common/enums';

export interface ScheduledDoseResult {
  doseLogId: string;
  medicationId: string;
  medName: string;
  dosage: string;
  note?: string;
  status: DoseStatus;
}
