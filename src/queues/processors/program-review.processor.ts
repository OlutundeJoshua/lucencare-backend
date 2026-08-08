import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { PROGRAM_REVIEW_JOB } from 'src/queues/queues.constants';
import { ProgramReviewJob } from 'src/queues/interfaces/program-review-job.interface';

/**
 * Tell the platform admins a funding programme is waiting on them.
 *
 * This threw `Not implemented` until now, so a submitted programme sat in
 * `pending_review` with nobody told it existed — and, since there is no other
 * signal, it could never be approved and never reach a patient.
 */
@Injectable()
export class ProgramReviewProcessor {
  private readonly logger = new Logger(ProgramReviewProcessor.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async process(job: Job<ProgramReviewJob>): Promise<void> {
    if (job.name !== PROGRAM_REVIEW_JOB) return;

    const { programId, orgId, title } = job.data;

    const admins = await this.userRepo.find({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });

    if (admins.length === 0) {
      this.logger.warn(`No platform admins to notify about program ${programId} pending review`);
      return;
    }

    await this.notificationsService.createBulk(
      admins.map((a) => a.id),
      NotificationType.PROGRAM_PENDING_REVIEW,
      { programId, orgId, programTitle: title },
    );
  }
}
