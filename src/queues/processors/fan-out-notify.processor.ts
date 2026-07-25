// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { FAN_OUT_NOTIFY_JOB } from 'src/queues/queues.constants';

@Injectable()
export class FanOutNotifyProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== FAN_OUT_NOTIFY_JOB) return;
    // Pages eligible patients in batches of 200
    // Enqueues one batch_notify job per chunk — never one job per patient
    throw new Error('Not implemented');
  }
}
