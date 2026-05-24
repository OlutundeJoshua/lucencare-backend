// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ADMIN_QUEUE, PROGRAM_REVIEW_JOB } from 'src/queues/queues.constants';

@Processor(ADMIN_QUEUE)
export class ProgramReviewProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== PROGRAM_REVIEW_JOB) return;
    // Notify platform admins of new program pending review
    throw new Error('Not implemented');
  }
}
