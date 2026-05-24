// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { NOTIFICATIONS_QUEUE, FAN_OUT_NOTIFY_JOB } from 'src/queues/queues.constants';

@Processor(NOTIFICATIONS_QUEUE)
export class FanOutNotifyProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== FAN_OUT_NOTIFY_JOB) return;
    // Pages eligible patients in batches of 200
    // Enqueues one batch_notify job per chunk — never one job per patient
    throw new Error('Not implemented');
  }
}
