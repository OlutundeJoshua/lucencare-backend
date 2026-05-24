// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { NOTIFICATIONS_QUEUE, STUDY_APPROVED_JOB } from 'src/queues/queues.constants';

@Processor(NOTIFICATIONS_QUEUE)
export class StudyApprovedProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== STUDY_APPROVED_JOB) return;
    // Notify researcher that their study was approved/rejected
    throw new Error('Not implemented');
  }
}
