// TODO: Implement — see docs/modules/programs.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { ProgramType, ProgramStatus } from 'src/common/enums';

@Entity('programs')
@Index(['orgId'])
@Index(['status'])
@Index(['expiresAt'])
export class Program extends BaseEntity {
  @Column({ name: 'org_id', type: 'char', length: 26 })
  orgId: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'type', type: 'varchar', enum: ProgramType })
  type: ProgramType;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: ProgramStatus,
    default: ProgramStatus.PENDING_REVIEW,
  })
  status: ProgramStatus;

  @Column({ name: 'eligibility_criteria', type: 'jsonb' })
  eligibilityCriteria: object[];

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
