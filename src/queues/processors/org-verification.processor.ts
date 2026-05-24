// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ADMIN_QUEUE, ORG_VERIFICATION_JOB } from 'src/queues/queues.constants';

@Processor(ADMIN_QUEUE)
export class OrgVerificationProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== ORG_VERIFICATION_JOB) return;
    // Notify platform admins of new org pending verification
    throw new Error('Not implemented');
  }
}
