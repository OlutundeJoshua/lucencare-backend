import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import {
  APPLICATION_REVIEW_JOB,
  COMMUNITY_REPORT_JOB,
  ORG_VERIFICATION_JOB,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  PROGRAM_REVIEW_JOB,
  STUDY_REVIEW_JOB,
} from 'src/queues/queues.constants';

import { AdminQueueProcessor } from './admin-queue.processor';
import { ApplicationReviewProcessor } from './application-review.processor';
import { CommunityReportProcessor } from './community-report.processor';
import { OrgVerificationProcessor } from './org-verification.processor';
import { ProgramOutcomeProcessor } from './program-outcome.processor';
import { ProgramReviewProcessor } from './program-review.processor';
import { StudyReviewProcessor } from './study-review.processor';

describe('AdminQueueProcessor', () => {
  let processor: AdminQueueProcessor;
  let orgVerificationProcessor: { process: jest.Mock };
  let studyReviewProcessor: { process: jest.Mock };
  let programReviewProcessor: { process: jest.Mock };
  let programOutcomeProcessor: { process: jest.Mock };
  let applicationReviewProcessor: { process: jest.Mock };
  let communityReportProcessor: { process: jest.Mock };

  beforeEach(async () => {
    orgVerificationProcessor = { process: jest.fn() };
    studyReviewProcessor = { process: jest.fn() };
    programReviewProcessor = { process: jest.fn() };
    programOutcomeProcessor = { process: jest.fn() };
    applicationReviewProcessor = { process: jest.fn() };
    communityReportProcessor = { process: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminQueueProcessor,
        { provide: OrgVerificationProcessor, useValue: orgVerificationProcessor },
        { provide: StudyReviewProcessor, useValue: studyReviewProcessor },
        { provide: ProgramReviewProcessor, useValue: programReviewProcessor },
        { provide: ProgramOutcomeProcessor, useValue: programOutcomeProcessor },
        { provide: ApplicationReviewProcessor, useValue: applicationReviewProcessor },
        { provide: CommunityReportProcessor, useValue: communityReportProcessor },
      ],
    }).compile();

    processor = module.get<AdminQueueProcessor>(AdminQueueProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('routes org_verification jobs to OrgVerificationProcessor', async () => {
    const job = { name: ORG_VERIFICATION_JOB, data: {} } as Job;
    await processor.process(job);
    expect(orgVerificationProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes study_review jobs to StudyReviewProcessor', async () => {
    const job = { name: STUDY_REVIEW_JOB, data: {} } as Job;
    await processor.process(job);
    expect(studyReviewProcessor.process).toHaveBeenCalledWith(job);
  });

  // Both outcome jobs are produced onto THIS queue; they used to be routed only on
  // NOTIFICATIONS_QUEUE, so every approval and rejection notice was discarded.
  it('routes program_approved jobs to ProgramOutcomeProcessor', async () => {
    const job = { name: PROGRAM_APPROVED_JOB, data: {} } as Job;
    await processor.process(job);
    expect(programOutcomeProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes program_rejected jobs to ProgramOutcomeProcessor', async () => {
    const job = { name: PROGRAM_REJECTED_JOB, data: {} } as Job;
    await processor.process(job);
    expect(programOutcomeProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes program_review jobs to ProgramReviewProcessor', async () => {
    const job = { name: PROGRAM_REVIEW_JOB, data: {} } as Job;
    await processor.process(job);
    expect(programReviewProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes application_review jobs to ApplicationReviewProcessor', async () => {
    const job = { name: APPLICATION_REVIEW_JOB, data: {} } as Job;
    await processor.process(job);
    expect(applicationReviewProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes community_report jobs to CommunityReportProcessor', async () => {
    const job = { name: COMMUNITY_REPORT_JOB, data: {} } as Job;
    await processor.process(job);
    expect(communityReportProcessor.process).toHaveBeenCalledWith(job);
  });

  it('does nothing for an unrecognized job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;
    await processor.process(job);
    expect(orgVerificationProcessor.process).not.toHaveBeenCalled();
    expect(studyReviewProcessor.process).not.toHaveBeenCalled();
    expect(programReviewProcessor.process).not.toHaveBeenCalled();
    expect(applicationReviewProcessor.process).not.toHaveBeenCalled();
    expect(communityReportProcessor.process).not.toHaveBeenCalled();
  });
});
