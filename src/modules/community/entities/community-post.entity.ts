import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CommunityContentStatus } from 'src/common/enums';

@Entity('community_posts')
@Index(['communityId'])
@Index(['authorUserId'])
export class CommunityPost extends BaseEntity {
  @Column({ name: 'community_id', type: 'char', length: 26 })
  communityId: string;

  /** The JWT `sub` of whoever wrote it. Never a patient id. */
  @Column({ name: 'author_user_id', type: 'char', length: 26 })
  authorUserId: string;

  @Column({ name: 'title', type: 'text', nullable: true })
  title?: string | null;

  @Column({ name: 'body', type: 'text' })
  body: string;

  @Column({ name: 'tags', type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  /**
   * Moderation state. A hidden post is NOT deleted and NOT soft-deleted: the report
   * that caused the hide points at this row, and deleting it would destroy the
   * evidence. It stays visible to its own author, with hiddenReason, and 404s to
   * everyone else — a 403 would confirm the content exists.
   */
  @Column({
    name: 'status',
    type: 'varchar',
    enum: CommunityContentStatus,
    default: CommunityContentStatus.PUBLISHED,
  })
  status: CommunityContentStatus;

  @Column({ name: 'hidden_at', type: 'timestamptz', nullable: true })
  hiddenAt?: Date | null;

  @Column({ name: 'hidden_by', type: 'char', length: 26, nullable: true })
  hiddenBy?: string | null;

  @Column({ name: 'hidden_reason', type: 'text', nullable: true })
  hiddenReason?: string | null;

  /** Display counters — see the note on Community. Never read by getStats(). */
  @Column({ name: 'comment_count', type: 'integer', default: 0 })
  commentCount: number;

  @Column({ name: 'reaction_count', type: 'integer', default: 0 })
  reactionCount: number;

  /**
   * Bumped when a comment lands. Display only — the feed sorts by `id` (a ULID, so
   * already time-ordered), because sorting by this would need a composite cursor.
   */
  @Column({ name: 'last_activity_at', type: 'timestamptz', default: () => 'now()' })
  lastActivityAt: Date;
}
