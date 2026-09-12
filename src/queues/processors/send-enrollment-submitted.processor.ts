import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SEND_ENROLLMENT_SUBMITTED_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { SendEnrollmentSubmittedJob } from 'src/queues/interfaces/send-enrollment-submitted-job.interface';

/**
 * The acknowledgement a patient gets for applying to a programme.
 *
 * Mirrors the RECEIVED case of the application-status email, which every other
 * applicant type already gets. Patients applying to a programme were the one
 * applicant group whose submission was met with silence: the NGO was notified
 * in-app, the audit log recorded it, and the patient heard nothing until a decision.
 */
@Injectable()
export class SendEnrollmentSubmittedProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendEnrollmentSubmittedJob>): Promise<void> {
    if (job.name !== SEND_ENROLLMENT_SUBMITTED_JOB) return;

    const { to, patientName, programTitle } = job.data;
    const fundingUrl = `${this.configService.get<string>('app.frontendUrl')}/patient/funding/plans`;

    await this.mailService.send(to, `We have received your application to ${programTitle}`, {
      preheader: 'You will hear from us as soon as a decision has been made.',
      blocks: [
        { kind: 'paragraph', text: `Hi ${patientName},` },
        {
          kind: 'callout',
          text: `Your application to ${programTitle} has been submitted.`,
        },
        {
          kind: 'paragraph',
          text: 'The programme team will review it and decide who joins the programme.',
        },
        { kind: 'paragraph', text: 'You will get an email as soon as a decision has been made.' },
        {
          kind: 'button',
          label: 'View applications',
          url: fundingUrl,
          textLabel: 'View your applications',
        },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ] as EmailBlock[],
    });
  }
}
