import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CommunityContentStatus } from 'src/common/enums';

@Entity('community_comments')
@Index(['postId'])
@Index(['authorUserId'])
export class CommunityComment extends BaseEntity {
  @Column({ name: 'post_id', type: 'char', length: 26 })
  postId: string;

  /**
   * Set when this is a reply to another comment. Exactly ONE level of nesting: a
   * reply to a reply is re-parented to the top-level comment by
   * CommunityService.createComment(). A CHECK constraint cannot express this — it
   * would have to read another row of the same table — so the rule lives in the
   * service and is covered by a unit test.
   */
  @Column({ name: 'parent_comment_id', type: 'char', length: 26, nullable: true })
  parentCommentId?: string | null;

  /**
   * Denormalised from the parent post. The moderation queue and every per-community
   * view would otherwise join to community_posts on each read. Immutable in practice:
   * a post never changes community.
   */
  @Column({ name: 'community_id', type: 'char', length: 26 })
  communityId: string;

  @Column({ name: 'author_user_id', type: 'char', length: 26 })
  authorUserId: string;

  @Column({ name: 'body', type: 'text' })
  body: string;

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

  @Column({ name: 'reaction_count', type: 'integer', default: 0 })
  reactionCount: number;
}
