// TODO: Implement — see docs/modules/queues.md

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { MAIL_QUEUE, SEND_OTP_JOB } from 'src/queues/queues.constants';

@Processor(MAIL_QUEUE)
export class SendOtpProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== SEND_OTP_JOB) return;
    // Sends OTP email to researcher — stores code in Redis with OTP_TTL_SECONDS
    throw new Error('Not implemented');
  }
}
