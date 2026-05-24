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
}
