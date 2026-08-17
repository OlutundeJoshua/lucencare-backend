import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CommunityReactionType } from 'src/common/enums';

/**
 * One "helpful" mark on one post or one comment.
 *
 * Two rules that must not be softened:
 *
 * 1. **Unlike is a hard DELETE, never a soft delete.** A soft-deleted row still
 *    occupies the partial unique index, so re-liking would violate it and surface as
 *    a 500. There is no audit value in retaining an unlike.
 * 2. **Exactly one of postId / commentId is set**, enforced by
 *    `chk_community_reactions_target` (num_nonnulls = 1) in the migration.
 */
@Entity('community_reactions')
@Index(['targetAuthorUserId'])
export class CommunityReaction extends BaseEntity {
  @Column({ name: 'user_id', type: 'char', length: 26 })
  userId: string;

  @Column({ name: 'post_id', type: 'char', length: 26, nullable: true })
  postId?: string | null;

  @Column({ name: 'comment_id', type: 'char', length: 26, nullable: true })
  commentId?: string | null;

  /**
   * Whose content was marked. Denormalised so "Helpful marks" is one index-only
   * count. Resolving it live would mean COALESCE across two LEFT JOINs, which no
   * index can serve — a sequential scan of the whole table on every dashboard load.
   * Immutable: a post's author never changes.
   *
   * The count is index-only ONLY because IDX_community_reactions_target_author_live
   * is partial on `deleted_at IS NULL` (migration 1785700000000). With a plain index
   * the same predicate forces a heap fetch per row — 18ms rather than 2ms at 4k
   * reactions, and linear in an author's popularity from there.
   */
  @Column({ name: 'target_author_user_id', type: 'char', length: 26 })
  targetAuthorUserId: string;

  @Column({
    name: 'type',
    type: 'varchar',
    enum: CommunityReactionType,
    default: CommunityReactionType.LIKE,
  })
  type: CommunityReactionType;
}
