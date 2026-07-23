import { Patient } from '../entities/patient.entity';
import { CareEvent } from '../entities/care-event.entity';

export interface PatientSummaryData {
  patient: Patient;
  careEvents: CareEvent[];
}
