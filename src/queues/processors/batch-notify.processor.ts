// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { BATCH_NOTIFY_JOB } from 'src/queues/queues.constants';

@Injectable()
export class BatchNotifyProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== BATCH_NOTIFY_JOB) return;
    // Single bulk INSERT into notifications for all patient IDs in batch
    throw new Error('Not implemented');
  }
}
