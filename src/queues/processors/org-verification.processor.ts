import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ORG_VERIFICATION_JOB } from 'src/queues/queues.constants';
import { OrgVerificationJob } from 'src/queues/interfaces/org-verification-job.interface';

@Injectable()
export class OrgVerificationProcessor {
  private readonly logger = new Logger(OrgVerificationProcessor.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Notify platform admins that an organisation is awaiting verification.
  async process(job: Job<OrgVerificationJob>): Promise<void> {
    if (job.name !== ORG_VERIFICATION_JOB) return;

    const { orgId, orgName, contactEmail } = job.data;

    const admins = await this.userRepo.find({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });

    if (admins.length === 0) {
      this.logger.warn(`No platform admins to notify about org ${orgId} pending verification`);
      return;
    }

    await this.notificationsService.createBulk(
      admins.map((a) => a.id),
      NotificationType.ORG_PENDING_VERIFICATION,
      { orgId, orgName, contactEmail },
    );
  }
}
