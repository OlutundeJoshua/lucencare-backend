// TODO: Implement — see docs/modules/patients.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { Gender } from 'src/common/enums';

@Entity('patients')
@Index(['userId'], { unique: true })
@Index(['hmoId'])
@Index(['phone'])
export class Patient extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26, unique: true })
  userId!: string;

  @Column({ name: 'hmo_id', type: 'char', length: 26, nullable: true })
  hmoId?: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'phone', type: 'text', unique: true })
  phone!: string;

  @Column({ name: 'membership_number', type: 'text', nullable: true, unique: true })
  membershipNumber?: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string;

  @Column({ name: 'gender', type: 'enum', enum: Gender, nullable: true })
  gender?: Gender;

  @Column({ name: 'address', type: 'text', nullable: true })
  address?: string;

  @Column({ name: 'condition_tags', type: 'text', array: true, default: '{}' })
  conditionTags!: string[];

  @Column({ name: 'medication_list', type: 'jsonb', nullable: true })
  medicationList?: object[];

  @Column({ name: 'direct_contact_shared', type: 'boolean', default: false })
  directContactShared!: boolean;
}
