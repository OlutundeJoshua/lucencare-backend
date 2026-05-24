// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { NOTIFICATIONS_QUEUE, BATCH_NOTIFY_JOB } from 'src/queues/queues.constants';

@Processor(NOTIFICATIONS_QUEUE)
export class BatchNotifyProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== BATCH_NOTIFY_JOB) return;
    // Single bulk INSERT into notifications for all patient IDs in batch
    throw new Error('Not implemented');
  }
}
