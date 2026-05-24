// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { NOTIFICATIONS_QUEUE, PROGRAM_APPROVED_JOB } from 'src/queues/queues.constants';

@Processor(NOTIFICATIONS_QUEUE)
export class ProgramApprovedProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== PROGRAM_APPROVED_JOB) return;
    // Notify NGO org staff that their program was approved/rejected
    throw new Error('Not implemented');
  }
}
