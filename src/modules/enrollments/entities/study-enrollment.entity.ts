// TODO: Implement — see docs/modules/enrollments.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { StudyEnrollmentStatus } from 'src/common/enums';

@Entity('study_enrollments')
@Index(['patientId'])
@Index(['studyId'])
@Index(['patientId', 'studyId'], { unique: true })
export class StudyEnrollment extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'study_id', type: 'char', length: 26 })
  studyId: string;

  @Column({ name: 'consent_grant_id', type: 'char', length: 26 })
  consentGrantId: string;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: StudyEnrollmentStatus,
    default: StudyEnrollmentStatus.INTERESTED,
  })
  status: StudyEnrollmentStatus;

  @Column({ name: 'shared_data_snapshot', type: 'jsonb' })
  sharedDataSnapshot: object;

  @Column({ name: 'direct_contact_shared', type: 'boolean', default: false })
  directContactShared: boolean;
}
