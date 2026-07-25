// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { CONSENT_REVOKED_JOB } from 'src/queues/queues.constants';

@Injectable()
export class ConsentRevokedProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== CONSENT_REVOKED_JOB) return;
    // Notify affected orgs that patient consent has been revoked
    throw new Error('Not implemented');
  }
}
