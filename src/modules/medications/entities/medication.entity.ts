import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';

@Entity('medications')
@Index(['patientId'])
export class Medication extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'dosage', type: 'text' })
  dosage: string;

  @Column({ name: 'condition', type: 'text' })
  condition: string;

  @Column({ name: 'frequency', type: 'text' })
  frequency: string;

  @Column({ name: 'schedule_times', type: 'text', array: true, default: '{}' })
  scheduleTimes: string[];

  @Column({ name: 'prescriber', type: 'text' })
  prescriber: string;

  @Column({ name: 'specialty', type: 'text' })
  specialty: string;

  @Column({ name: 'pills_remaining', type: 'int' })
  pillsRemaining: number;

  @Column({ name: 'pills_total', type: 'int' })
  pillsTotal: number;

  @Column({ name: 'refill_date', type: 'date' })
  refillDate: string;

  @Column({ name: 'rxnorm_code', type: 'text', nullable: true })
  rxnormCode?: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;
}
