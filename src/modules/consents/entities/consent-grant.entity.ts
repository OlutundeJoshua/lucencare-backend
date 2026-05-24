// TODO: Implement — see docs/modules/consents.md

import { Entity, Column, Index, VersionColumn } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { ConsentPurpose, ConsentStatus } from 'src/common/enums';

@Entity('consent_grants')
@Index(['patientId', 'purpose'])
@Index(['patientId', 'status'])
export class ConsentGrant extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'purpose', type: 'varchar', enum: ConsentPurpose })
  purpose: ConsentPurpose;

  @Column({ name: 'data_scopes', type: 'text', array: true })
  dataScopes: string[];

  @Column({
    name: 'status',
    type: 'varchar',
    enum: ConsentStatus,
    default: ConsentStatus.NOT_GRANTED,
  })
  status: ConsentStatus;

  @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'NOW()' })
  grantedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @VersionColumn({ name: 'version' })
  version: number;
}
