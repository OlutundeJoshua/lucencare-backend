import { Job } from 'bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import {
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  ORG_VERIFICATION_JOB,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  SEND_PROGRAM_STATUS_JOB,
} from 'src/queues/queues.constants';
import { ProgramOutcomeJob } from 'src/queues/interfaces/program-outcome-job.interface';

import { ProgramOutcomeProcessor } from './program-outcome.processor';

const JOB_DATA: ProgramOutcomeJob = {
  programId: '01HZZZZZZZZZZZZZZZZZZZZZAB',
  orgId: '01HZZZZZZZZZZZZZZZZZZZZZAC',
  programTitle: 'Chronic Care Fund',
};

function makeJob(name: string, data: ProgramOutcomeJob = JOB_DATA): Job<ProgramOutcomeJob> {
  return { name, data } as Job<ProgramOutcomeJob>;
}

describe('ProgramOutcomeProcessor', () => {
  let processor: ProgramOutcomeProcessor;
  let userRepo: { find: jest.Mock };
  let orgRepo: { findOne: jest.Mock };
  let notificationsService: { createBulk: jest.Mock };
  let mailQueue: { add: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'user-1', email: 'admin@hope.org', name: 'Bisi Lawal' },
        { id: 'user-2', email: 'second@hope.org', name: 'Ade Okafor' },
      ]),
    };
    orgRepo = { findOne: jest.fn().mockResolvedValue({ id: JOB_DATA.orgId, name: 'Hope Health' }) };
    notificationsService = { createBulk: jest.fn() };
    mailQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgramOutcomeProcessor,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();

    processor = module.get<ProgramOutcomeProcessor>(ProgramOutcomeProcessor);
  });

  describe('approval', () => {
    it('notifies every staff member in the org and emails one of them', async () => {
      await processor.process(makeJob(PROGRAM_APPROVED_JOB));

      // Resolved by org, not program.createdBy — that column is null for anything
      // created without a CLS user, which left the old notice unaddressed.
      expect(userRepo.find).toHaveBeenCalledWith({
        where: { orgId: JOB_DATA.orgId, role: UserRole.NGO_ADMIN },
        select: ['id', 'email', 'name'],
      });
      expect(notificationsService.createBulk).toHaveBeenCalledWith(
        ['user-1', 'user-2'],
        NotificationType.PROGRAM_REVIEWED,
        expect.objectContaining({ programId: JOB_DATA.programId, approved: true }),
      );
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_PROGRAM_STATUS_JOB,
        expect.objectContaining({
          to: 'admin@hope.org',
          programTitle: 'Chronic Care Fund',
          approved: true,
        }),
        MAIL_JOB_OPTIONS,
      );
    });
  });

  describe('rejection', () => {
    it('carries the reason into both channels', async () => {
      await processor.process(
        makeJob(PROGRAM_REJECTED_JOB, { ...JOB_DATA, reason: 'Eligibility too broad' }),
      );

      expect(notificationsService.createBulk).toHaveBeenCalledWith(
        expect.any(Array),
        NotificationType.PROGRAM_REVIEWED,
        expect.objectContaining({ approved: false, reason: 'Eligibility too broad' }),
      );
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_PROGRAM_STATUS_JOB,
        expect.objectContaining({ approved: false, reason: 'Eligibility too broad' }),
        MAIL_JOB_OPTIONS,
      );
    });
  });

  it('ignores jobs multiplexed onto the same queue under a different name', async () => {
    await processor.process(makeJob(ORG_VERIFICATION_JOB));

    expect(userRepo.find).not.toHaveBeenCalled();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  // Must not throw: BullMQ would retry an unrecoverable condition forever.
  it('resolves without sending anything when the org has no staff', async () => {
    userRepo.find.mockResolvedValue([]);

    await expect(processor.process(makeJob(PROGRAM_APPROVED_JOB))).resolves.toBeUndefined();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('falls back to the org name when a staff user has none', async () => {
    userRepo.find.mockResolvedValue([{ id: 'user-1', email: 'admin@hope.org', name: '' }]);

    await processor.process(makeJob(PROGRAM_APPROVED_JOB));

    expect(mailQueue.add).toHaveBeenCalledWith(
      SEND_PROGRAM_STATUS_JOB,
      expect.objectContaining({ recipientName: 'Hope Health' }),
      MAIL_JOB_OPTIONS,
    );
  });
});
