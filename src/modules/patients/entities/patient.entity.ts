// TODO: Implement — see docs/modules/patients.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';

@Entity('patients')
@Index(['userId'], { unique: true })
@Index(['hmoId'])
@Index(['locationState'])
@Index(['locationLga'])
export class Patient extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26, unique: true })
  userId: string;

  @Column({ name: 'hmo_id', type: 'char', length: 26, nullable: true })
  hmoId?: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'phone_hash', type: 'text', nullable: true, unique: true })
  phoneHash?: string;

  @Column({ name: 'membership_number', type: 'text', nullable: true, unique: true })
  membershipNumber?: string;

  @Column({ name: 'condition_tags', type: 'text', array: true, default: '{}' })
  conditionTags: string[];

  @Column({ name: 'location_state', type: 'text', nullable: true })
  locationState?: string;

  @Column({ name: 'location_lga', type: 'text', nullable: true })
  locationLga?: string;

  @Column({ name: 'medication_list', type: 'jsonb', nullable: true })
  medicationList?: object[];

  @Column({ name: 'direct_contact_shared', type: 'boolean', default: false })
  directContactShared: boolean;
}
