// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { PROGRAM_REVIEW_JOB } from 'src/queues/queues.constants';

@Injectable()
export class ProgramReviewProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== PROGRAM_REVIEW_JOB) return;
    // Notify platform admins of new program pending review
    throw new Error('Not implemented');
  }
}
