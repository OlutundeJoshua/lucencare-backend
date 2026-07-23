// TODO: Implement — see docs/modules/queues.md

import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { PROGRAM_APPROVED_JOB } from 'src/queues/queues.constants';

@Injectable()
export class ProgramApprovedProcessor {
  async process(job: Job): Promise<void> {
    if (job.name !== PROGRAM_APPROVED_JOB) return;
    // Notify NGO org staff that their program was approved/rejected
    throw new Error('Not implemented');
  }
}
