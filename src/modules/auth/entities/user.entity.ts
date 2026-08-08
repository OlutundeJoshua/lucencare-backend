import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { UserRole } from 'src/common/enums';

@Entity('users')
@Index(['email'], { unique: true })
@Index(['orgId'])
@Index(['role'])
export class User extends BaseEntity {
  @Column({ name: 'role', type: 'enum', enum: UserRole, enumName: 'user_role' })
  role: UserRole;

  @Column({ name: 'org_id', type: 'char', length: 26, nullable: true })
  orgId?: string;

  // Display name for every role. PATIENT users additionally carry a name on the
  // Patient entity, which stays the source of truth for them.
  @Column({ name: 'name', type: 'text', nullable: true })
  name?: string;

  @Column({ name: 'email', type: 'text', unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status: string;

  @Column({ name: 'institution_id', type: 'char', length: 26, nullable: true })
  institutionId?: string;
}
