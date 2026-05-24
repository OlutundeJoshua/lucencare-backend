// TODO: Implement — see docs/modules/auth.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { UserRole } from 'src/common/enums';

@Entity('users')
@Index(['email'], { unique: true })
@Index(['orgId'])
@Index(['role'])
export class User extends BaseEntity {
  @Column({ name: 'role', type: 'varchar', enum: UserRole })
  role: UserRole;

  @Column({ name: 'org_id', type: 'char', length: 26, nullable: true })
  orgId?: string;

  @Column({ name: 'email', type: 'text', unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status: string;

  @Column({ name: 'institution_id', type: 'char', length: 26, nullable: true })
  institutionId?: string;
}
