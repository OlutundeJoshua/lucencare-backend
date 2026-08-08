import { Job } from 'bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ORG_VERIFICATION_JOB, PROGRAM_REVIEW_JOB } from 'src/queues/queues.constants';
import { ProgramReviewJob } from 'src/queues/interfaces/program-review-job.interface';

import { ProgramReviewProcessor } from './program-review.processor';

const JOB_DATA: ProgramReviewJob = {
  programId: '01HZZZZZZZZZZZZZZZZZZZZZAB',
  orgId: '01HZZZZZZZZZZZZZZZZZZZZZAC',
  title: 'Chronic Care Fund',
};

function makeJob(name = PROGRAM_REVIEW_JOB, data = JOB_DATA): Job<ProgramReviewJob> {
  return { name, data } as Job<ProgramReviewJob>;
}

describe('ProgramReviewProcessor', () => {
  let processor: ProgramReviewProcessor;
  let userRepo: { find: jest.Mock };
  let notificationsService: { createBulk: jest.Mock };

  beforeEach(async () => {
    userRepo = { find: jest.fn() };
    notificationsService = { createBulk: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgramReviewProcessor,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get<ProgramReviewProcessor>(ProgramReviewProcessor);
  });

  // This threw `Not implemented` until now, so a submitted programme reached nobody.
  it('notifies every platform admin that a programme is awaiting review', async () => {
    userRepo.find.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await processor.process(makeJob());

    expect(userRepo.find).toHaveBeenCalledWith({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });
    expect(notificationsService.createBulk).toHaveBeenCalledWith(
      ['admin-1', 'admin-2'],
      NotificationType.PROGRAM_PENDING_REVIEW,
      {
        programId: JOB_DATA.programId,
        orgId: JOB_DATA.orgId,
        programTitle: JOB_DATA.title,
      },
    );
  });

  it('ignores jobs multiplexed onto the same queue under a different name', async () => {
    await processor.process(makeJob(ORG_VERIFICATION_JOB));

    expect(userRepo.find).not.toHaveBeenCalled();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
  });

  // Must not throw: BullMQ would retry forever on an unrecoverable condition.
  it('resolves without notifying when no platform admins exist', async () => {
    userRepo.find.mockResolvedValue([]);

    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
  });
});
