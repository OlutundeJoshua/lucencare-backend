import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { CommunityStatus } from 'src/common/enums';

/**
 * A support group patients join to talk about a shared condition.
 *
 * Created by patients (see CommunityService.createCommunity) and archived — never
 * deleted — by a platform admin. Archiving keeps existing threads readable to the
 * people who wrote them while closing the community to new posts.
 */
@Entity('communities')
@Index(['status'])
export class Community extends BaseEntity {
  @Column({ name: 'name', type: 'text' })
  name: string;

  /** Stable, human-readable route segment. Unique among non-deleted rows. */
  @Column({ name: 'slug', type: 'text' })
  slug: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string | null;

  /** Icon and accent colour are presentation, stored so every client agrees. */
  @Column({ name: 'icon', type: 'text', nullable: true })
  icon?: string | null;

  @Column({ name: 'accent', type: 'text', nullable: true })
  accent?: string | null;

  /**
   * Shown before a member's first post. The one structural mitigation for the fact
   * that a free-text health post bypasses every ConsentGrant on the platform.
   */
  @Column({ name: 'disclaimer', type: 'text', nullable: true })
  disclaimer?: string | null;

  @Column({ name: 'tags', type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({
    name: 'status',
    type: 'varchar',
    enum: CommunityStatus,
    default: CommunityStatus.ACTIVE,
  })
  status: CommunityStatus;

  /**
   * Display counters. Maintained with SQL expressions inside the same transaction as
   * the write that moves them, never read-modify-write. Deliberately NOT the source
   * for anything on a dashboard — see CommunityService.getStats().
   */
  @Column({ name: 'member_count', type: 'integer', default: 0 })
  memberCount: number;

  @Column({ name: 'post_count', type: 'integer', default: 0 })
  postCount: number;

  /** The user who founded it. BaseEntity.createdBy is set by the CLS subscriber. */
  @Column({ name: 'created_by_user_id', type: 'char', length: 26 })
  createdByUserId: string;
}
