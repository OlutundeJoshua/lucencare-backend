import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CommunityReportReason, CommunityReportStatus } from 'src/common/enums';

/**
 * A member's complaint about a post or a comment.
 *
 * Exactly one of postId / commentId is set (`chk_community_reports_target`). A
 * reporter may hold only one PENDING report per target — a partial unique index in
 * the migration turns a repeat into a 409 rather than a pile of duplicate rows.
 */
@Entity('community_reports')
@Index(['status'])
export class CommunityReport extends BaseEntity {
  @Column({ name: 'reporter_user_id', type: 'char', length: 26 })
  reporterUserId: string;

  @Column({ name: 'post_id', type: 'char', length: 26, nullable: true })
  postId?: string | null;

  @Column({ name: 'comment_id', type: 'char', length: 26, nullable: true })
  commentId?: string | null;

  /** Denormalised so the moderation queue can name the community without a join. */
  @Column({ name: 'community_id', type: 'char', length: 26 })
  communityId: string;

  @Column({ name: 'reason', type: 'varchar', enum: CommunityReportReason })
  reason: CommunityReportReason;

  /** Required by CreateReportDto when reason is OTHER. */
  @Column({ name: 'details', type: 'text', nullable: true })
  details?: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    enum: CommunityReportStatus,
    default: CommunityReportStatus.PENDING,
  })
  status: CommunityReportStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @Column({ name: 'reviewed_by', type: 'char', length: 26, nullable: true })
  reviewedBy?: string | null;
}
