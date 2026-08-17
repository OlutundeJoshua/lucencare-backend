import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  CommunityReportReason,
  CommunityReportTarget,
  NotificationType,
  UserRole,
} from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import {
  COMMUNITY_REPORT_JOB,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
  PROGRAM_REVIEW_JOB,
} from 'src/queues/queues.constants';
import { CommunityReportJob } from 'src/queues/interfaces/community-report-job.interface';

import { CommunityReportProcessor } from './community-report.processor';

const JOB_DATA: CommunityReportJob = {
  reportId: '01HZZZZZZZZZZZZZZZZZZZZRPT',
  targetType: CommunityReportTarget.POST,
  targetId: '01HZZZZZZZZZZZZZZZZZZZPOST',
  communityId: '01HZZZZZZZZZZZZZZZZZZZZCOM',
  communityName: 'Diabetes Support',
  reason: CommunityReportReason.PERSONAL_DATA,
  excerpt: 'Call me on 0803…',
};

function job(over: Partial<Job<CommunityReportJob>> = {}): Job<CommunityReportJob> {
  return { name: COMMUNITY_REPORT_JOB, data: JOB_DATA, ...over } as Job<CommunityReportJob>;
}

describe('CommunityReportProcessor', () => {
  let processor: CommunityReportProcessor;
  let userRepo: { find: jest.Mock };
  let notificationsService: { createBulk: jest.Mock };

  beforeEach(async () => {
    userRepo = { find: jest.fn().mockResolvedValue([{ id: 'ADMIN1' }, { id: 'ADMIN2' }]) };
    notificationsService = { createBulk: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityReportProcessor,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get(CommunityReportProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  // The sub-processor self-guards because one WorkerHost multiplexes the whole
  // queue by job name.
  it('ignores a job that is not its own', async () => {
    await processor.process(job({ name: PROGRAM_REVIEW_JOB }));
    expect(userRepo.find).not.toHaveBeenCalled();
  });

  it('notifies every platform admin', async () => {
    await processor.process(job());

    expect(userRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: UserRole.PLATFORM_ADMIN } }),
    );
    expect(notificationsService.createBulk).toHaveBeenCalledWith(
      ['ADMIN1', 'ADMIN2'],
      NotificationType.COMMUNITY_CONTENT_REPORTED,
      expect.objectContaining({ reportId: JOB_DATA.reportId, communityName: 'Diabetes Support' }),
    );
  });

  it('warns and stops when there are no admins, rather than writing nothing quietly', async () => {
    userRepo.find.mockResolvedValue([]);
    const warn = jest.spyOn(processor['logger'], 'warn').mockImplementation();

    await processor.process(job());

    expect(warn).toHaveBeenCalled();
    expect(notificationsService.createBulk).not.toHaveBeenCalled();
  });

  // createBulk's contract is "never more than 200 rows at once".
  it('chunks above the fan-out batch size', async () => {
    const admins = Array.from({ length: NOTIFICATION_FAN_OUT_BATCH_SIZE + 5 }, (_, i) => ({
      id: `ADMIN${i}`,
    }));
    userRepo.find.mockResolvedValue(admins);

    await processor.process(job());

    expect(notificationsService.createBulk).toHaveBeenCalledTimes(2);
    expect(notificationsService.createBulk.mock.calls[0][0]).toHaveLength(NOTIFICATION_FAN_OUT_BATCH_SIZE);
    expect(notificationsService.createBulk.mock.calls[1][0]).toHaveLength(5);
  });
});
