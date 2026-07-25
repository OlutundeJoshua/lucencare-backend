import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  ADMIN_QUEUE,
  ORG_VERIFICATION_JOB,
  PROGRAM_REVIEW_JOB,
  STUDY_REVIEW_JOB,
} from 'src/queues/queues.constants';

import { OrgVerificationProcessor } from './org-verification.processor';
import { ProgramReviewProcessor } from './program-review.processor';
import { StudyReviewProcessor } from './study-review.processor';

@Processor(ADMIN_QUEUE)
export class AdminQueueProcessor extends WorkerHost {
  constructor(
    private readonly orgVerificationProcessor: OrgVerificationProcessor,
    private readonly studyReviewProcessor: StudyReviewProcessor,
    private readonly programReviewProcessor: ProgramReviewProcessor,
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
      default:
        return;
    }
  }
}
