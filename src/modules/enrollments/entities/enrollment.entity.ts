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

  // ── NGO review ─────────────────────────────────────────────────────────────

  /** Required when status is REJECTED — the patient is told why. */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  /** The NGO staff user who decided. */
  @Column({ name: 'reviewed_by', type: 'char', length: 26, nullable: true })
  reviewedBy?: string | null;

  @VersionColumn({ name: 'version' })
  version: number;
}
