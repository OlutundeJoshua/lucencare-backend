import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { ApplicationStatus } from 'src/common/enums';

@Entity('benefactor_applications')
@Index(['userId'], { unique: true })
@Index(['status'])
export class BenefactorApplication extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26, unique: true })
  userId: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ name: 'phone', type: 'varchar', length: 30 })
  phone: string;

  @Column({ name: 'reason_for_support', type: 'text' })
  reasonForSupport: string;

  @Column({ name: 'id_consent_given', type: 'boolean', default: false })
  idConsentGiven: boolean;

  @Column({ name: 'id_consent_at', type: 'timestamptz', nullable: true })
  idConsentAt?: Date;

  @Column({ name: 'terms_consent_at', type: 'timestamptz', nullable: true })
  termsConsentAt?: Date;

  @Column({ name: 'code_of_conduct_consent_at', type: 'timestamptz', nullable: true })
  codeOfConductConsentAt?: Date;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  status: ApplicationStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', default: () => 'NOW()' })
  submittedAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  @Column({ name: 'reviewed_by', type: 'char', length: 26, nullable: true })
  reviewedBy?: string;
}
