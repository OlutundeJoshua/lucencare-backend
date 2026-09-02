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

    await this.mailService.send(to, 'Your LucenCare verification code', {
      // Deliberately excludes the code itself: the preheader surfaces on lock screens
      // and in notification banners, where a one-time code should not.
      preheader: `Your one-time verification code, valid for ${expiresInMinutes} minutes.`,
      blocks: [
        { kind: 'paragraph', text: 'Hello,' },
        { kind: 'code', value: code, caption: 'Your one-time verification code is:' },
        {
          kind: 'paragraph',
          text: `This code expires in ${expiresInMinutes} minutes. If you did not request this code, you can safely ignore this email.`,
        },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ],
    });
  }
}
