// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { STUDY_REVIEW_JOB } from 'src/queues/queues.constants';

@Injectable()
export class StudyReviewProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== STUDY_REVIEW_JOB) return;
    // Notify platform admins of new study pending review
    throw new Error('Not implemented');
  }
}
