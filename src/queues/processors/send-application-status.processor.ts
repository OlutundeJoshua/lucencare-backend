import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApplicantRole, ApplicationEmailEvent } from 'src/common/enums';
import { SEND_APPLICATION_STATUS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { SendApplicationStatusJob } from 'src/queues/interfaces/send-application-status-job.interface';

/**
 * What each role is called and what approval unlocks for them. Composed with the
 * event templates below, these four entries plus three templates cover all twelve
 * role x event messages — so the wording stays consistent across roles by
 * construction rather than by discipline.
 *
 * Adding a role: add it to ApplicantRole and add an entry here. Nothing else.
 */
const ROLE_COPY: Record<ApplicantRole, { label: string; capabilities: string[] }> = {
  [ApplicantRole.NGO]: {
    label: 'NGO',
    capabilities: [
      'Create and manage funding programmes',
      'Review patients who match your programmes',
      'Track enrolment and programme impact',
    ],
  },
  [ApplicantRole.HMO]: {
    label: 'HMO',
    capabilities: [
      'Look up and link your enrolled members',
      'Record care events against a member',
      'Export member care summaries',
    ],
  },
  [ApplicantRole.PROFESSIONAL]: {
    label: 'healthcare professional',
    capabilities: [
      'Coordinate care for patients who have consented',
      'Take part in community discussions',
      'Keep your professional profile up to date',
    ],
  },
  [ApplicantRole.BENEFACTOR]: {
    label: 'benefactor',
    capabilities: [
      'Browse patients and programmes seeking support',
      'Fund treatments and medications',
      'Follow the impact of what you have funded',
    ],
  },
};

@Injectable()
export class SendApplicationStatusProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendApplicationStatusJob>): Promise<void> {
    if (job.name !== SEND_APPLICATION_STATUS_JOB) return;

    const { to, applicantName, role, event, reason } = job.data;
    const { label, capabilities } = ROLE_COPY[role];

    const { subject, content } = this.compose(event, applicantName, label, capabilities, reason);

    await this.mailService.send(to, subject, content);
  }

  private compose(
    event: ApplicationEmailEvent,
    name: string,
    label: string,
    capabilities: string[],
    reason?: string,
  ): { subject: string; content: EmailContent } {
    switch (event) {
      case ApplicationEmailEvent.RECEIVED:
        return {
          subject: `We've received your ${label} application`,
          content: {
            preheader: 'Our team will review it within 48 hours.',
            // Mirrors what the onboarding wizard already tells the user on submit, so
            // the email does not contradict the screen they just saw.
            blocks: [
              { kind: 'paragraph', text: `Hi ${name},` },
              {
                kind: 'paragraph',
                text: `Thank you for submitting your ${label} application to LucenCare. Our team will review it within 48 hours.`,
              },
              {
                kind: 'paragraph',
                text: "You'll receive an email as soon as a decision has been made. There is nothing else you need to do for now.",
              },
              { kind: 'signoff', text: 'The LucenCare Team' },
            ],
          },
        };

      case ApplicationEmailEvent.APPROVED: {
        const loginUrl = `${this.configService.get<string>('app.frontendUrl')}/login`;
        return {
          subject: `Your ${label} application has been approved`,
          content: {
            preheader: 'Your account is now active.',
            blocks: [
              { kind: 'paragraph', text: `Hi ${name},` },
              // The outcome line is the callout in all three of the review emails
              // (application, programme, enrolment), so they read alike.
              {
                kind: 'callout',
                text: `Good news — your ${label} application has been approved and your account is now active.`,
              },
              { kind: 'list', lead: 'You can now:', items: capabilities },
              {
                kind: 'button',
                label: 'Sign in',
                url: loginUrl,
                textLabel: 'Sign in to get started',
              },
              { kind: 'signoff', text: 'The LucenCare Team' },
            ],
          },
        };
      }

      case ApplicationEmailEvent.REJECTED:
        return {
          subject: `Your ${label} application was not approved`,
          content: {
            blocks: [
              { kind: 'paragraph', text: `Hi ${name},` },
              {
                kind: 'callout',
                text: `We've reviewed your ${label} application and it was not approved.`,
              },
              // Omitted entirely when absent — never "Reason: undefined".
              ...(reason ? [{ kind: 'paragraph' as const, text: `Reason: ${reason}` }] : []),
              // Same wording as the in-app rejected screen (PendingVerificationComponent),
              // so the two channels say the same thing.
              {
                kind: 'paragraph',
                text: "If you believe this is a mistake, contact support for more information. You're welcome to apply again once the issue above has been resolved.",
              },
              { kind: 'signoff', text: 'The LucenCare Team' },
            ],
          },
        };
    }
  }
}
