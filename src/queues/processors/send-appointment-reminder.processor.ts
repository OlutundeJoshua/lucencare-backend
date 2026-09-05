import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { SEND_APPOINTMENT_REMINDER_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { formatLeadPhrase } from 'src/common/utils/lead-phrase.util';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { SendAppointmentReminderJob } from 'src/queues/interfaces/send-appointment-reminder-job.interface';

/** A lead of a day or more; the warmer, further-out voice is used from here up. */
const DISTANT_LEAD_MINUTES = 24 * 60;

/**
 * The copy for a reminder, derived from how far ahead it is.
 *
 * Generated rather than written per lead because the schedule is configurable
 * (APPOINTMENT_REMINDER_LEADS). Copy keyed to a lead's name would start lying the
 * moment someone changed its value, and an email headed "in 1 hour" that arrives two
 * hours early is worse than no reminder — the patient plans around it.
 *
 * Three voices, chosen by distance: the appointment's own moment, something imminent,
 * and something far enough out to be a nudge rather than a prompt.
 */
function appointmentReminderCopy(leadMinutes: number): {
  subject: (name: string) => string;
  opener: string;
  prep: boolean;
} {
  const phrase = formatLeadPhrase(leadMinutes);

  if (leadMinutes <= 0) {
    return {
      subject: (name) => `${name}, it's appointment time`,
      opener: 'Your appointment starts now.',
      // No prep list at this point — there is no longer time to act on it, and a
      // checklist arriving as someone walks in reads as pressure rather than help.
      prep: false,
    };
  }

  if (leadMinutes >= DISTANT_LEAD_MINUTES) {
    return {
      subject: (name) => `Psst, ${name} — you've got an appointment ${phrase}!`,
      opener: `You've got an appointment ${phrase}.`,
      prep: true,
    };
  }

  return {
    subject: (name) => `${name}, your appointment is ${phrase}`,
    opener: `You've got an appointment ${phrase}.`,
    prep: true,
  };
}

const PREP_BLOCKS: EmailBlock[] = [
  {
    kind: 'list',
    lead: "Before you go, here's your 60-second prep list:",
    items: [
      'Grab any recent test results or your med list',
      'Jot down that one question you keep forgetting to ask',
    ],
  },
  { kind: 'paragraph', text: "That's it. You're basically already prepped." },
];

@Injectable()
export class SendAppointmentReminderProcessor {
  private readonly logger = new Logger(SendAppointmentReminderProcessor.name);

  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendAppointmentReminderJob>): Promise<void> {
    if (job.name !== SEND_APPOINTMENT_REMINDER_JOB) return;

    for (const target of job.data.targets) {
      // A job enqueued just before the deploy that introduced leadMinutes carries the
      // old named lead instead, leaving this undefined. Skip it rather than rendering
      // "in NaN hours" — and one stale target must not fail the whole batch of up to
      // 200 reminders behind it.
      if (!Number.isFinite(target.leadMinutes)) {
        this.logger.warn(
          `Skipping appointment reminder with unreadable leadMinutes=${target.leadMinutes}`,
        );
        continue;
      }

      const copy = appointmentReminderCopy(target.leadMinutes);

      try {
        await this.mailService.send(target.email, copy.subject(target.firstName), {
          preheader: `${copy.opener} ${target.appointmentDate} at ${target.time}.`,
          blocks: [
            { kind: 'paragraph', text: `Hey ${target.firstName},` },
            { kind: 'callout', text: copy.opener },
            {
              kind: 'detailRows',
              lead: 'Appointment details:',
              rows: [
                { label: 'Type', value: target.appointmentType },
                { label: 'Date', value: target.appointmentDate },
                { label: 'Time', value: target.time },
                { label: 'Location', value: target.facility },
                { label: 'With', value: target.provider },
              ],
            },
            ...(copy.prep ? PREP_BLOCKS : []),
            { kind: 'signoff', text: "You've got this,\nThe LucenCare Team 💚" },
          ],
        });
      } catch (err) {
        // Isolate per-target failures so one bad address or transient SMTP error does
        // not drop the reminders for the rest of this batch of up to 200 patients.
        this.logger.error(
          `Failed to send appointment reminder to=${target.email} lead=${target.leadMinutes}: ${(err as Error).message}`,
        );
      }
    }
  }
}
