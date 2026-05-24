// TODO: Implement — see docs/modules/patients.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CareEventType } from 'src/common/enums';

@Entity('care_events')
@Index(['patientId'])
@Index(['patientId', 'eventDate'])
export class CareEvent extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'type', type: 'varchar', enum: CareEventType })
  type: CareEventType;

  @Column({ name: 'event_date', type: 'date' })
  eventDate: Date;

  @Column({ name: 'provider_name', type: 'text', nullable: true, length: 200 })
  providerName?: string;

  @Column({ name: 'structured', type: 'jsonb' })
  structured: object;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;
}
