import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/modules/audit/audit.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { QueuesModule } from 'src/queues/queues.module';
import { User } from 'src/modules/auth/entities/user.entity';

import { CommunityController, CommunityModerationController } from './community.controller';
import { CommunityService } from './community.service';
import { Community } from './entities/community.entity';
import { CommunityComment } from './entities/community-comment.entity';
import { CommunityMembership } from './entities/community-membership.entity';
import { CommunityPost } from './entities/community-post.entity';
import { CommunityReaction } from './entities/community-reaction.entity';
import { CommunityReport } from './entities/community-report.entity';

/**
 * The community.
 *
 * `User` is registered here only so resolveAuthors() can turn an author id into a
 * display name and a verified badge. It reaches `patients` through a raw LEFT JOIN
 * for one column — the name — and never through a repository, which is why the
 * Patient entity is deliberately absent from forFeature.
 *
 * The moderation controller lives here too rather than in AdminModule: putting it
 * there would mean AdminModule importing CommunityModule, and would split community
 * queries across two services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      CommunityMembership,
      CommunityPost,
      CommunityComment,
      CommunityReaction,
      CommunityReport,
      User,
    ]),
    AuditModule,
    NotificationsModule,
    QueuesModule,
  ],
  controllers: [CommunityController, CommunityModerationController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
