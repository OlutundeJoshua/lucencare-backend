import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { ApplicationStatus, ProfessionType } from 'src/common/enums';

@Entity('professional_applications')
@Index(['userId'], { unique: true })
@Index(['status'])
export class ProfessionalApplication extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26, unique: true })
  userId: string;

  @Column({ name: 'profession', type: 'varchar', enum: ProfessionType })
  profession: ProfessionType;

  @Column({ name: 'license_number', type: 'text' })
  licenseNumber: string;

  @Column({ name: 'specialty', type: 'text' })
  specialty: string;

  @Column({ name: 'years_of_experience', type: 'integer' })
  yearsOfExperience: number;

  @Column({ name: 'phone', type: 'varchar', length: 30 })
  phone: string;

  @Column({ name: 'bio', type: 'text' })
  bio: string;

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
