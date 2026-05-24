// TODO: Implement — see docs/modules/studies.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { StudyStatus } from 'src/common/enums';

@Entity('studies')
@Index(['researcherId'])
@Index(['status'])
export class Study extends BaseEntity {
  @Column({ name: 'researcher_id', type: 'char', length: 26 })
  researcherId: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'irb_number', type: 'text' })
  irbNumber: string;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: StudyStatus,
    default: StudyStatus.PENDING_REVIEW,
  })
  status: StudyStatus;

  @Column({ name: 'eligibility_criteria', type: 'jsonb' })
  eligibilityCriteria: object[];

  @Column({ name: 'info_sheet_url', type: 'text' })
  infoSheetUrl: string;

  @Column({ name: 'target_count', type: 'int' })
  targetCount: number;

  @Column({ name: 'compensation_details', type: 'text', nullable: true })
  compensationDetails?: string;
}
