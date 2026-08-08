import { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import {
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  SEND_PROGRAM_STATUS_JOB,
} from 'src/queues/queues.constants';
import { ProgramOutcomeJob } from 'src/queues/interfaces/program-outcome-job.interface';
import { SendProgramStatusJob } from 'src/queues/interfaces/send-program-status-job.interface';

/**
 * Tells an NGO what the platform decided about its programme — in the app and by
 * email.
 *
 * One processor for both outcomes rather than two near-identical files: the only
 * difference is the copy, and the recipient lookup is the fiddly part. Previously
 * `program_approved` threw `Not implemented` and `program_rejected` had no handler
 * at all, so an NGO was never told either way.
 */
@Injectable()
export class ProgramOutcomeProcessor {
  private readonly logger = new Logger(ProgramOutcomeProcessor.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
  ) {}

  async process(job: Job<ProgramOutcomeJob>): Promise<void> {
    if (job.name !== PROGRAM_APPROVED_JOB && job.name !== PROGRAM_REJECTED_JOB) return;

    const approved = job.name === PROGRAM_APPROVED_JOB;
    const { programId, orgId, programTitle, reason } = job.data;

    // Resolved from the organisation, not program.createdBy: that column is null
    // for anything created without a CLS user, which left the notice unaddressed.
    const staff = await this.userRepo.find({
      where: { orgId, role: UserRole.NGO_ADMIN },
      select: ['id', 'email', 'name'],
    });

    if (staff.length === 0) {
      this.logger.warn(`No NGO staff to notify about program ${programId} outcome`);
      return;
    }

    await this.notificationsService.createBulk(
      staff.map((s) => s.id),
      NotificationType.PROGRAM_REVIEWED,
      { programId, programTitle, approved, reason },
    );

    const org = await this.orgRepo.findOne({ where: { id: orgId }, select: ['id', 'name'] });

    // One email to the staff member on record; the in-app notice above reaches
    // everyone. A mail failure must not lose the in-app notification, so this is
    // last and the job's own retries cover the enqueue.
    const recipient = staff[0];
    const payload: SendProgramStatusJob = {
      to: recipient.email,
      recipientName: recipient.name || org?.name || 'there',
      programTitle,
      approved,
      reason,
    };
    await this.mailQueue.add(SEND_PROGRAM_STATUS_JOB, payload, MAIL_JOB_OPTIONS);
  }
}
