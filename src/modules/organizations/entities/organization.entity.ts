// TODO: Implement — see docs/modules/organizations.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { OrgType, OrgStatus } from 'src/common/enums';

@Entity('organizations')
@Index(['type'])
@Index(['status'])
export class Organization extends BaseEntity {
  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'type', type: 'varchar', enum: OrgType })
  type: OrgType;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: OrgStatus,
    default: OrgStatus.PENDING_VERIFICATION,
  })
  status: OrgStatus;

  @Column({ name: 'contact_email', type: 'text' })
  contactEmail: string;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date;

  @Column({ name: 'verified_by', type: 'char', length: 26, nullable: true })
  verifiedBy?: string;

  // Shared onboarding fields
  @Column({ name: 'registration_number', type: 'text', nullable: true })
  registrationNumber?: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone?: string;

  @Column({ name: 'website', type: 'varchar', length: 500, nullable: true })
  website?: string;

  // NGO-specific onboarding fields
  @Column({ name: 'focus_areas', type: 'text', nullable: true })
  focusAreas?: string;

  @Column({ name: 'operating_regions', type: 'text', nullable: true })
  operatingRegions?: string;

  @Column({ name: 'head_office_country', type: 'varchar', length: 10, nullable: true })
  headOfficeCountry?: string;

  @Column({ name: 'program_description', type: 'text', nullable: true })
  programDescription?: string;

  // HMO-specific onboarding fields
  @Column({ name: 'licence_number', type: 'text', nullable: true })
  licenceNumber?: string;

  @Column({ name: 'coverage_region', type: 'varchar', length: 10, nullable: true })
  coverageRegion?: string;

  @Column({ name: 'enrolled_patient_count', type: 'varchar', length: 20, nullable: true })
  enrolledPatientCount?: string;

  @Column({ name: 'specialty_focus', type: 'text', nullable: true })
  specialtyFocus?: string;
}
