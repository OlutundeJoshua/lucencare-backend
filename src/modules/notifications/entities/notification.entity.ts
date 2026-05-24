// TODO: Implement — see docs/modules/notifications.md

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { NotificationType } from 'src/common/enums';

@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
export class Notification extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26 })
  userId: string;

  @Column({ name: 'type', type: 'varchar', enum: NotificationType })
  type: NotificationType;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: object;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date;
}
