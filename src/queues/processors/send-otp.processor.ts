import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { SEND_OTP_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendOtpJob } from 'src/queues/interfaces/send-otp-job.interface';

@Injectable()
export class SendOtpProcessor {
  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendOtpJob>): Promise<void> {
    if (job.name !== SEND_OTP_JOB) return;

    const { to, code, expiresInMinutes } = job.data;

    await this.mailService.send(
      to,
      'Your LucenCare verification code',
      `Hello,\n\nYour one-time verification code is ${code}.\n\nThis code expires in ${expiresInMinutes} minutes. If you did not request this code, you can safely ignore this email.\n\nThe LucenCare Team`,
    );
  }
}
