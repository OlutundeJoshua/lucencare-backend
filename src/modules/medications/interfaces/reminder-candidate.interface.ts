import { MedicationReminderLead } from 'src/common/enums';
import { Patient } from 'src/modules/patients/entities/patient.entity';

/**
 * One dose matched to one lead, before grouping and before the already-taken filter.
 *
 * Internal to `MedicationsService.findDueReminderTargets`: it exists because the tick
 * has to collect every candidate across all patients before it can check which doses
 * are already resolved in a single query, rather than one query per dose.
 */
export interface ReminderCandidate {
  patient: Patient;
  email: string;
  lead: MedicationReminderLead;
  /** Minutes past local midnight — the grouping key, so two labels at one moment merge. */
  slotMinutes: number;
  /** The date this occurrence lands on, which may be tomorrow for a wrapped lead. */
  doseDate: string;
  medicationId: string;
  /** The label exactly as stored, because that is how the dose log is keyed. */
  scheduledTime: string;
  name: string;
  dosage: string;
}
