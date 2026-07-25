import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { SEND_PATIENT_CREDENTIALS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendPatientCredentialsJob } from 'src/queues/interfaces/send-patient-credentials-job.interface';

@Injectable()
export class SendPatientCredentialsProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendPatientCredentialsJob>): Promise<void> {
    if (job.name !== SEND_PATIENT_CREDENTIALS_JOB) return;

    const { to, tempPassword } = job.data;
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    const loginUrl = `${frontendUrl}/login`;

    await this.mailService.send(
      to,
      'Your LucenCare account has been created',
      `Hello,\n\nAn account has been created for you on LucenCare.\n\nEmail: ${to}\nTemporary password: ${tempPassword}\n\nPlease log in at ${loginUrl} and change your password as soon as possible.\n\nThe LucenCare Team`,
    );
  }
}
