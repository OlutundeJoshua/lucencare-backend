import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SEND_PROGRAM_STATUS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { SendProgramStatusJob } from 'src/queues/interfaces/send-program-status-job.interface';

/**
 * Copy per outcome, in the same composed-table shape as the application-status and
 * enrollment-outcome emails, so all three read alike.
 */
const OUTCOME_COPY = {
  approved: {
    subject: (p: string) => `${p} has been approved`,
    lead: (p: string) => `${p} has been approved and is now live.`,
    next: 'Patients who match your eligibility criteria can see it and apply from today. Applications appear in your Applicants queue as they arrive.',
  },
  rejected: {
    subject: (p: string) => `${p} was not approved`,
    lead: (p: string) => `${p} has been reviewed and was not approved for publication.`,
    next: 'You can edit the programme and submit it again — it stays in your Programmes list until you do.',
  },
};

@Injectable()
export class SendProgramStatusProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendProgramStatusJob>): Promise<void> {
    if (job.name !== SEND_PROGRAM_STATUS_JOB) return;

    const { to, recipientName, programTitle, approved, reason } = job.data;
    const copy = approved ? OUTCOME_COPY.approved : OUTCOME_COPY.rejected;
    const programsUrl = `${this.configService.get<string>('app.frontendUrl')}/ngo/programs`;

    await this.mailService.send(to, copy.subject(programTitle), {
      preheader: copy.lead(programTitle),
      blocks: [
        { kind: 'paragraph', text: `Hi ${recipientName},` },
        { kind: 'callout', text: copy.lead(programTitle) },
        // Omitted entirely when absent — never "Reason: undefined".
        ...(reason ? [{ kind: 'paragraph', text: `Reason: ${reason}` } as EmailBlock] : []),
        { kind: 'paragraph', text: copy.next },
        {
          kind: 'button',
          label: 'View programmes',
          url: programsUrl,
          textLabel: 'View your programmes',
        },
        { kind: 'signoff', text: 'The LucenCare Team' },
      ],
    });
  }
}
