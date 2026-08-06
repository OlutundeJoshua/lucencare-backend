import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { APPLICATION_REVIEW_JOB, ORG_VERIFICATION_JOB } from 'src/queues/queues.constants';

import { ApplicationReviewProcessor } from './application-review.processor';

const JOB_DATA = {
  applicationId: '01HZZZZZZZZZZZZZZZZZZZZZA1',
  applicationType: 'professional_application' as const,
  applicantName: 'Dr Ada Obi',
  applicantEmail: 'ada@example.com',
};

describe('ApplicationReviewProcessor', () => {
  let processor: ApplicationReviewProcessor;
  let userRepo: { find: jest.Mock };
  let notificationsService: { createBulk: jest.Mock };

  beforeEach(async () => {
    userRepo = { find: jest.fn().mockResolvedValue([{ id: 'ADMIN1' }, { id: 'ADMIN2' }]) };
    notificationsService = { createBulk: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationReviewProcessor,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get<ApplicationReviewProcessor>(ApplicationReviewProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function makeJob(name: string): Job {
    return { name, data: JOB_DATA } as Job;
  }

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('notifies every platform admin that an application needs review', async () => {
    await processor.process(makeJob(APPLICATION_REVIEW_JOB));

    expect(userRepo.find).toHaveBeenCalledWith({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });
    expect(notificationsService.createBulk).toHaveBeenCalledWith(
      ['ADMIN1', 'ADMIN2'],
      NotificationType.APPLICATION_PENDING_REVIEW,
      JOB_DATA,
    );
  });

  it('ignores jobs multiplexed onto the same queue under a different name', async () => {
    await processor.process(makeJob(ORG_VERIFICATION_JOB));

    expect(userRepo.find).not.toHaveBeenCalled();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
  });

  // Must not throw: BullMQ would retry an unrecoverable condition forever.
  it('resolves without notifying when no platform admins exist', async () => {
    userRepo.find.mockResolvedValue([]);

    await expect(processor.process(makeJob(APPLICATION_REVIEW_JOB))).resolves.toBeUndefined();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
  });

  it('handles benefactor applications too', async () => {
    const job = {
      name: APPLICATION_REVIEW_JOB,
      data: { ...JOB_DATA, applicationType: 'benefactor_application' as const },
    } as Job;

    await processor.process(job);

    expect(notificationsService.createBulk).toHaveBeenCalledWith(
      ['ADMIN1', 'ADMIN2'],
      NotificationType.APPLICATION_PENDING_REVIEW,
      expect.objectContaining({ applicationType: 'benefactor_application' }),
    );
  });
});
