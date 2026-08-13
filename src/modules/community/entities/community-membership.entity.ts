import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';

/**
 * One user's membership of one community.
 *
 * `userId` is the JWT `sub` — a user id, not a patient id. Professionals and
 * benefactors join the same communities patients do, and neither has a patients row.
 *
 * Leaving is a SOFT delete, which is why the uniqueness index in the migration is
 * partial (`WHERE deleted_at IS NULL`). A plain unique index would make rejoining
 * after leaving impossible.
 */
@Entity('community_memberships')
@Index(['userId'])
@Index(['communityId'])
export class CommunityMembership extends BaseEntity {
  @Column({ name: 'community_id', type: 'char', length: 26 })
  communityId: string;

  @Column({ name: 'user_id', type: 'char', length: 26 })
  userId: string;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt: Date;

  /**
   * When this member acknowledged the community's disclaimer. Stamped on join so a
   * later change to the disclaimer text can be re-acknowledged without guessing who
   * has seen which version.
   */
  @Column({ name: 'code_of_conduct_at', type: 'timestamptz', nullable: true })
  codeOfConductAt?: Date | null;
}
