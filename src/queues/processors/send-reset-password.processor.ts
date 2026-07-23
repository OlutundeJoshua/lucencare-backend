import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { SEND_RESET_PASSWORD_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendResetPasswordJob } from 'src/queues/interfaces/send-reset-password-job.interface';

@Injectable()
export class SendResetPasswordProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendResetPasswordJob>): Promise<void> {
    if (job.name !== SEND_RESET_PASSWORD_JOB) return;

    const { to, token, expiresInMinutes } = job.data;
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    await this.mailService.send(
      to,
      'Reset your LucenCare password',
      `Hello,\n\nWe received a request to reset your password. Click the link below to choose a new one:\n\n${resetLink}\n\nThis link expires in ${expiresInMinutes} minutes. If you did not request a password reset, you can safely ignore this email.\n\nThe LucenCare Team`,
    );
  }
}
