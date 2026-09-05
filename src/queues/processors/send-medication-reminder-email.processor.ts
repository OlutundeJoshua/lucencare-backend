import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MedicationReminderLead } from 'src/common/enums';
import { SEND_MEDICATION_REMINDER_EMAIL_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { ReminderMedication } from 'src/modules/medications/interfaces/reminder-medication.interface';
import { SendMedicationReminderEmailJob } from 'src/queues/interfaces/send-medication-reminder-email-job.interface';

/**
 * Per-lead copy. Add a lead to MedicationReminderLead plus
 * MEDICATION_REMINDER_LEAD_MINUTES and an entry here — the Record makes a missing one a
 * compile error rather than a silently unsent email.
 *
 * Subjects are split by count because one email can now cover several medications: a
 * patient with three due at 8:00 AM gets one email, not three.
 */
const MEDICATION_REMINDER_COPY: Record<
  MedicationReminderLead,
  {
    subject: (name: string, meds: ReminderMedication[]) => string;
    opener: string;
    nudge: string;
  }
> = {
  [MedicationReminderLead.THIRTY_MINUTES]: {
    subject: (name, meds) =>
      meds.length === 1
        ? `${name}, ${meds[0].name} in 30 minutes`
        : `${name}, ${meds.length} medications in 30 minutes`,
    opener: 'Heads up — coming up in 30 minutes:',
    nudge: "A little warning so it doesn't sneak up on you.",
  },
  // The original line, kept deliberately — it is the one people quote back.
  [MedicationReminderLead.AT_TIME]: {
    subject: (name, meds) =>
      meds.length === 1
        ? `${name}, it's ${meds[0].name} o'clock`
        : `${name}, ${meds.length} medications due now`,
    opener: "Ding ding! It's time for:",
    nudge: "It takes a few seconds, and it's one of the best things you'll do for yourself today.",
  },
};

@Injectable()
export class SendMedicationReminderEmailProcessor {
  private readonly logger = new Logger(SendMedicationReminderEmailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendMedicationReminderEmailJob>): Promise<void> {
    if (job.name !== SEND_MEDICATION_REMINDER_EMAIL_JOB) return;

    const scheduleUrl = `${this.configService.get<string>('app.frontendUrl')}/patient/medications/schedule`;

    for (const target of job.data.targets) {
      const copy = MEDICATION_REMINDER_COPY[target.lead];
      // A job enqueued just before a deploy that changed the lead set carries a lead
      // this build no longer knows. Skip it rather than throwing — one stale target
      // must not fail the whole batch of up to 200 reminders behind it.
      if (!copy) {
        this.logger.warn(`Skipping medication reminder with unknown lead=${target.lead}`);
        continue;
      }

      // Defensive: a target with nothing due carries no message. The service already
      // drops empty groups, so this only guards a malformed payload.
      if (target.medications.length === 0) continue;

      try {
        await this.mailService.send(
          target.email,
          copy.subject(target.firstName, target.medications),
          {
            preheader: `Due at ${target.scheduledTime}.`,
            blocks: [
              { kind: 'paragraph', text: copy.opener },
              ...this.medicationBlocks(target.medications),
              { kind: 'paragraph', text: `Scheduled for ${target.scheduledTime}.` },
              { kind: 'paragraph', text: copy.nudge },
              {
                kind: 'button',
                label: 'Mark it done',
                url: scheduleUrl,
                textLabel: 'Tap here to mark it done',
              },
              // Dropped entirely at zero rather than printed as "0 day streak" — opening
              // a nudge by telling someone they have nothing going reads as a scolding.
              ...(target.streakDays > 0
                ? [
                    {
                      kind: 'paragraph',
                      text: `You're currently on a ${target.streakDays} day streak. Let's not let a tiny pill be the thing that breaks it.`,
                    } as EmailBlock,
                  ]
                : []),
              {
                kind: 'paragraph',
                text: 'If you need support, our support team is available 24/7.',
              },
              {
                kind: 'paragraph',
                text: "Remember, you've got this — and now, you've got LucenCare on this journey.",
              },
              { kind: 'signoff', text: 'The LucenCare Team 💚' },
            ],
          },
        );
      } catch (err) {
        // Isolate per-target failures so one bad address/transient SMTP error
        // doesn't drop reminders for the rest of this batch of up to 200 patients.
        this.logger.error(
          `Failed to send medication reminder to=${target.email} lead=${target.lead}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * A single medication keeps the callout it has always had; several become a list.
   * Stacking three callouts would give one email three competing focal points.
   */
  private medicationBlocks(medications: ReminderMedication[]): EmailBlock[] {
    if (medications.length === 1) {
      return [{ kind: 'callout', text: `${medications[0].name} — ${medications[0].dosage}` }];
    }

    return [{ kind: 'list', items: medications.map((m) => `${m.name} — ${m.dosage}`) }];
  }
}
