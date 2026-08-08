import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { APPLICATION_REVIEW_JOB } from 'src/queues/queues.constants';
import { ApplicationReviewJob } from 'src/queues/interfaces/application-review-job.interface';

/**
 * Sibling of OrgVerificationProcessor for professional and benefactor applications,
 * which previously notified nobody — so those two admin queues were only reviewed if
 * someone happened to open the tab.
 *
 * Kept separate rather than generalising OrgVerificationProcessor, whose payload and
 * notification type are organisation-shaped.
 */
@Injectable()
export class ApplicationReviewProcessor {
  private readonly logger = new Logger(ApplicationReviewProcessor.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async process(job: Job<ApplicationReviewJob>): Promise<void> {
    if (job.name !== APPLICATION_REVIEW_JOB) return;

    const { applicationId, applicationType, applicantName, applicantEmail } = job.data;

    const admins = await this.userRepo.find({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });

    if (admins.length === 0) {
      this.logger.warn(`No platform admins to notify about application ${applicationId} pending review`);
      return;
    }

    await this.notificationsService.createBulk(
      admins.map((a) => a.id),
      NotificationType.APPLICATION_PENDING_REVIEW,
      { applicationId, applicationType, applicantName, applicantEmail },
    );
  }
}
