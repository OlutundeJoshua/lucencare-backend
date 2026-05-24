// TODO: Implement — see docs/modules/audit.md
// INSERT-only: no UPDATE or DELETE — enforced via Postgres RLS (GRANT SELECT, INSERT only)

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { AuditAction } from 'src/common/enums';

@Entity('audit_log')
@Index(['actorId'])
@Index(['resourceType', 'resourceId'])
@Index(['createdAt'])
export class AuditLog extends BaseEntity {
  @Column({ name: 'actor_id', type: 'char', length: 26 })
  actorId: string;

  @Column({ name: 'action', type: 'varchar', enum: AuditAction })
  action: AuditAction;

  @Column({ name: 'resource_id', type: 'char', length: 26 })
  resourceId: string;

  @Column({ name: 'resource_type', type: 'text' })
  resourceType: string;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: object;
}
