import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import {
  COMMUNITY_REPORT_JOB,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
} from 'src/queues/queues.constants';
import { CommunityReportJob } from 'src/queues/interfaces/community-report-job.interface';

/**
 * Tell the platform admins that community content has been reported.
 *
 * The community equivalent of ProgramReviewProcessor. Chunked at
 * NOTIFICATION_FAN_OUT_BATCH_SIZE because createBulk's contract is "never more than
 * 200 rows at once" — today there are a handful of admins, but the cap is the
 * contract, not the current row count.
 */
@Injectable()
export class CommunityReportProcessor {
  private readonly logger = new Logger(CommunityReportProcessor.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async process(job: Job<CommunityReportJob>): Promise<void> {
    if (job.name !== COMMUNITY_REPORT_JOB) return;

    const { reportId, targetType, targetId, communityId, communityName, reason, excerpt } = job.data;

    const admins = await this.userRepo.find({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });

    if (admins.length === 0) {
      this.logger.warn(`No platform admins to notify about community report ${reportId}`);
      return;
    }

    const ids = admins.map((a) => a.id);
    for (let i = 0; i < ids.length; i += NOTIFICATION_FAN_OUT_BATCH_SIZE) {
      await this.notificationsService.createBulk(
        ids.slice(i, i + NOTIFICATION_FAN_OUT_BATCH_SIZE),
        NotificationType.COMMUNITY_CONTENT_REPORTED,
        { reportId, targetType, targetId, communityId, communityName, reason, excerpt },
      );
    }
  }
}
