// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { STUDY_APPROVED_JOB } from 'src/queues/queues.constants';

@Injectable()
export class StudyApprovedProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== STUDY_APPROVED_JOB) return;
    // Notify researcher that their study was approved/rejected
    throw new Error('Not implemented');
  }
}
