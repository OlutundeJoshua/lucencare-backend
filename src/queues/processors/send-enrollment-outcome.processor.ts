import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnrollmentStatus, ReviewableEnrollmentStatus } from 'src/common/enums';
import { SEND_ENROLLMENT_OUTCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { SendEnrollmentOutcomeJob } from 'src/queues/interfaces/send-enrollment-outcome-job.interface';

/**
 * Copy per outcome. Same composed-table approach as the application-status emails:
 * add a status to REVIEWABLE_ENROLLMENT_STATUSES and an entry here, nothing else.
 */
const OUTCOME_COPY: Record<
  ReviewableEnrollmentStatus,
  { subject: (p: string) => string; lead: (p: string) => string; next: string }
> = {
  [EnrollmentStatus.SELECTED]: {
    subject: (p) => `You have been selected for ${p}`,
    lead: (p) => `Good news — you have been selected for ${p}.`,
    next: 'The programme coordinator will be in touch with next steps. You can see this on your Funding page at any time.',
  },
  [EnrollmentStatus.WAITLISTED]: {
    subject: (p) => `You are on the waiting list for ${p}`,
    lead: (p) => `You have been placed on the waiting list for ${p}.`,
    next: 'If a place becomes available you will be contacted. Your application stays open — there is nothing else you need to do.',
  },
  [EnrollmentStatus.REJECTED]: {
    subject: (p) => `Your application to ${p} was not successful`,
    lead: (p) =>
      `We have reviewed your application to ${p} and it was not successful on this occasion.`,
    // Mirrors the in-app rejected copy so the two channels agree.
    next: 'You are welcome to apply to other programmes on your Funding page, and to this one again if it reopens.',
  },
};

@Injectable()
export class SendEnrollmentOutcomeProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendEnrollmentOutcomeJob>): Promise<void> {
    if (job.name !== SEND_ENROLLMENT_OUTCOME_JOB) return;

    const { to, patientName, programTitle, status, reason } = job.data;
    const copy = OUTCOME_COPY[status];
    const fundingUrl = `${this.configService.get<string>('app.frontendUrl')}/patient/funding/plans`;

    await this.mailService.send(to, copy.subject(programTitle), {
      preheader: copy.lead(programTitle),
      blocks: [
        { kind: 'paragraph', text: `Hi ${patientName},` },
        { kind: 'callout', text: copy.lead(programTitle) },
        // Omitted entirely when absent — never "Reason: undefined".
        ...(reason ? [{ kind: 'paragraph', text: `Reason: ${reason}` } as EmailBlock] : []),
        { kind: 'paragraph', text: copy.next },
        {
          kind: 'button',
          label: 'View applications',
          url: fundingUrl,
          textLabel: 'View your applications',
        },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ],
    });
  }
}
