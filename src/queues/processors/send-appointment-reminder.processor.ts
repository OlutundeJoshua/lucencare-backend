import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { AppointmentReminderLead } from 'src/common/enums';
import { SEND_APPOINTMENT_REMINDER_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendAppointmentReminderJob } from 'src/queues/interfaces/send-appointment-reminder-job.interface';

/**
 * Per-lead copy. Add a lead to AppointmentReminderLead plus APPOINTMENT_REMINDER_LEAD_MINUTES
 * and an entry here — the Record makes a missing one a compile error rather than a
 * silently unsent email.
 *
 * `subject` takes the first name; `opener` is the line above the appointment details.
 */
const APPOINTMENT_REMINDER_COPY: Record<
  AppointmentReminderLead,
  { subject: (name: string) => string; opener: string; prep: boolean }
> = {
  [AppointmentReminderLead.THREE_DAYS]: {
    subject: (name) => `Psst, ${name} — you've got an appointment coming up!`,
    opener: "You've got an appointment in 3 days.",
    prep: true,
  },
  [AppointmentReminderLead.ONE_HOUR]: {
    subject: (name) => `${name}, your appointment is in an hour`,
    opener: "You've got an appointment in 1 hour.",
    prep: true,
  },
  // No prep list at this point — there is no longer time to act on it, and a checklist
  // arriving as someone walks in reads as pressure rather than help.
  [AppointmentReminderLead.AT_TIME]: {
    subject: (name) => `${name}, it's appointment time`,
    opener: 'Your appointment starts now.',
    prep: false,
  },
};

const PREP_LIST = [
  "Before you go, here's your 60-second prep list:",
  '- Grab any recent test results or your med list',
  '- Jot down that one question you keep forgetting to ask',
  '',
  "That's it. You're basically already prepped.",
];

@Injectable()
export class SendAppointmentReminderProcessor {
  private readonly logger = new Logger(SendAppointmentReminderProcessor.name);

  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendAppointmentReminderJob>): Promise<void> {
    if (job.name !== SEND_APPOINTMENT_REMINDER_JOB) return;

    for (const target of job.data.targets) {
      const copy = APPOINTMENT_REMINDER_COPY[target.lead];

      try {
        await this.mailService.send(
          target.email,
          copy.subject(target.firstName),
          [
            `Hey ${target.firstName},`,
            '',
            copy.opener,
            '',
            'Appointment details:',
            `- Type: ${target.appointmentType}`,
            `- Date: ${target.appointmentDate}`,
            `- Time: ${target.time}`,
            `- Location: ${target.facility}`,
            `- With: ${target.provider}`,
            '',
            ...(copy.prep ? [...PREP_LIST, ''] : []),
            "You've got this,",
            'The LucenCare Team 💚',
          ].join('\n'),
        );
      } catch (err) {
        // Isolate per-target failures so one bad address or transient SMTP error does
        // not drop the reminders for the rest of this batch of up to 200 patients.
        this.logger.error(
          `Failed to send appointment reminder to=${target.email} lead=${target.lead}: ${(err as Error).message}`,
        );
      }
    }
  }
}
