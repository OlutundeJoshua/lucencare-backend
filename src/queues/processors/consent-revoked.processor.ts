// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { NOTIFICATIONS_QUEUE, CONSENT_REVOKED_JOB } from 'src/queues/queues.constants';

@Processor(NOTIFICATIONS_QUEUE)
export class ConsentRevokedProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== CONSENT_REVOKED_JOB) return;
    // Notify affected orgs that patient consent has been revoked
    throw new Error('Not implemented');
  }
}
