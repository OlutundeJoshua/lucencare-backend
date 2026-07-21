import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { DoseStatus } from 'src/common/enums';

@Entity('medication_dose_logs')
@Index(['patientId', 'doseDate'])
@Index(['medicationId', 'doseDate'])
@Index(['medicationId', 'doseDate', 'scheduledTime'], { unique: true })
export class MedicationDoseLog extends BaseEntity {
  @Column({ name: 'medication_id', type: 'char', length: 26 })
  medicationId: string;

  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'dose_date', type: 'date' })
  doseDate: string;

  @Column({ name: 'scheduled_time', type: 'text' })
  scheduledTime: string;

  @Column({ name: 'status', type: 'enum', enum: DoseStatus, default: DoseStatus.PENDING })
  status: DoseStatus;

  @Column({ name: 'taken_at', type: 'timestamptz', nullable: true })
  takenAt?: Date;
}
