// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ADMIN_QUEUE, STUDY_REVIEW_JOB } from 'src/queues/queues.constants';

@Processor(ADMIN_QUEUE)
export class StudyReviewProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== STUDY_REVIEW_JOB) return;
    // Notify platform admins of new study pending review
    throw new Error('Not implemented');
  }
}
