import { Job } from 'bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType, UserRole } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ORG_VERIFICATION_JOB, ORG_VERIFIED_JOB } from 'src/queues/queues.constants';
import { OrgVerificationJob } from 'src/queues/interfaces/org-verification-job.interface';

import { OrgVerificationProcessor } from './org-verification.processor';

const JOB_DATA: OrgVerificationJob = {
  orgId: '01HZZZZZZZZZZZZZZZZZZZZZAB',
  orgName: 'Hope Health Initiative',
  contactEmail: 'admin@hopehealth.org',
};

function makeJob(name = ORG_VERIFICATION_JOB, data = JOB_DATA): Job<OrgVerificationJob> {
  return { name, data } as Job<OrgVerificationJob>;
}

describe('OrgVerificationProcessor', () => {
  let processor: OrgVerificationProcessor;
  let userRepo: { find: jest.Mock };
  let notificationsService: { createBulk: jest.Mock };

  beforeEach(async () => {
    userRepo = { find: jest.fn() };
    notificationsService = { createBulk: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgVerificationProcessor,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get<OrgVerificationProcessor>(OrgVerificationProcessor);
  });

  it('notifies every platform admin that the org is pending verification', async () => {
    userRepo.find.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await processor.process(makeJob());

    expect(userRepo.find).toHaveBeenCalledWith({
      where: { role: UserRole.PLATFORM_ADMIN },
      select: ['id'],
    });
    expect(notificationsService.createBulk).toHaveBeenCalledWith(
      ['admin-1', 'admin-2'],
      NotificationType.ORG_PENDING_VERIFICATION,
      JOB_DATA,
    );
  });

  it('ignores jobs multiplexed onto the same queue under a different name', async () => {
    await processor.process(makeJob(ORG_VERIFIED_JOB));

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
