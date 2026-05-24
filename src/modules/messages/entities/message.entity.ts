// TODO: Implement — see docs/modules/messages.md
// DB constraint: CHECK (num_nonnulls(enrollment_id, study_enrollment_id) = 1)
// enforced in migration — exactly one FK must be non-null

import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';

@Entity('messages')
@Index(['recipientId'])
export class Message extends BaseEntity {
  @Column({ name: 'sender_id', type: 'char', length: 26 })
  senderId: string;

  @Column({ name: 'recipient_id', type: 'char', length: 26 })
  recipientId: string;

  @Column({ name: 'enrollment_id', type: 'char', length: 26, nullable: true })
  enrollmentId?: string;

  @Column({ name: 'study_enrollment_id', type: 'char', length: 26, nullable: true })
  studyEnrollmentId?: string;

  @Column({ name: 'body', type: 'text' })
  body: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date;
}
