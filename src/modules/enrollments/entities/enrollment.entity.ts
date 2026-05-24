// TODO: Implement — see docs/modules/enrollments.md

import { Entity, Column, Index, VersionColumn } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { EnrollmentStatus } from 'src/common/enums';

@Entity('enrollments')
@Index(['patientId'])
@Index(['programId'])
@Index(['consentGrantId'])
export class Enrollment extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'program_id', type: 'char', length: 26 })
  programId: string;

  @Column({ name: 'consent_grant_id', type: 'char', length: 26 })
  consentGrantId: string;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: EnrollmentStatus,
    default: EnrollmentStatus.ACTIVE,
  })
  status: EnrollmentStatus;

  @Column({ name: 'shared_data_snapshot', type: 'jsonb' })
  sharedDataSnapshot: object;

  @VersionColumn({ name: 'version' })
  version: number;
}
