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

    await this.mailService.send(to, 'Your LucenCare account has been created', {
      // No credentials in the preheader — it is visible without opening the email.
      preheader: 'Your sign-in details are inside.',
      blocks: [
        { kind: 'paragraph', text: 'Hello,' },
        { kind: 'paragraph', text: 'An account has been created for you on LucenCare.' },
        // No lead, so the text part renders these as bare "Label: value" lines rather
        // than bullets — two standalone facts, not a list.
        {
          kind: 'detailRows',
          rows: [
            { label: 'Email', value: to },
            { label: 'Temporary password', value: tempPassword },
          ],
        },
        {
          kind: 'paragraph',
          text: 'Please log in and change your password as soon as possible.',
        },
        { kind: 'button', label: 'Log in to LucenCare', url: loginUrl, textLabel: 'Log in at' },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ],
    });
  }
}
