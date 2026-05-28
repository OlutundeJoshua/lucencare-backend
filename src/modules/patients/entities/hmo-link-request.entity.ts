import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { HmoLinkRequestStatus } from 'src/common/enums';

@Entity('hmo_link_requests')
@Index(['patientId'])
@Index(['orgId'])
@Index(['patientId', 'orgId', 'status'])
export class HmoLinkRequest extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'org_id', type: 'char', length: 26 })
  orgId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: HmoLinkRequestStatus,
    default: HmoLinkRequestStatus.PENDING,
  })
  status: HmoLinkRequestStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
