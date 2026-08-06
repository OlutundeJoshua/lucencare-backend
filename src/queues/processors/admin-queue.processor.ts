import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  ADMIN_QUEUE,
  APPLICATION_REVIEW_JOB,
  ORG_VERIFICATION_JOB,
  PROGRAM_REVIEW_JOB,
  STUDY_REVIEW_JOB,
  WORKER_POLL_OPTIONS,
} from 'src/queues/queues.constants';

import { ApplicationReviewProcessor } from './application-review.processor';
import { OrgVerificationProcessor } from './org-verification.processor';
import { ProgramReviewProcessor } from './program-review.processor';
import { StudyReviewProcessor } from './study-review.processor';

@Processor(ADMIN_QUEUE, WORKER_POLL_OPTIONS)
export class AdminQueueProcessor extends WorkerHost {
  constructor(
    private readonly orgVerificationProcessor: OrgVerificationProcessor,
    private readonly studyReviewProcessor: StudyReviewProcessor,
    private readonly programReviewProcessor: ProgramReviewProcessor,
    private readonly applicationReviewProcessor: ApplicationReviewProcessor,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ORG_VERIFICATION_JOB:
        return this.orgVerificationProcessor.process(job);
      case STUDY_REVIEW_JOB:
        return this.studyReviewProcessor.process(job);
      case PROGRAM_REVIEW_JOB:
        return this.programReviewProcessor.process(job);
      case APPLICATION_REVIEW_JOB:
        return this.applicationReviewProcessor.process(job);
      default:
        return;
    }
  }
}
