// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { ORG_VERIFICATION_JOB } from 'src/queues/queues.constants';

@Injectable()
export class OrgVerificationProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== ORG_VERIFICATION_JOB) return;
    // Notify platform admins of new org pending verification
    throw new Error('Not implemented');
  }
}
