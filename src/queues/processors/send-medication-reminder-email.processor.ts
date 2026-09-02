import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SEND_MEDICATION_REMINDER_EMAIL_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { SendMedicationReminderEmailJob } from 'src/queues/interfaces/send-medication-reminder-email-job.interface';

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
      try {
        await this.mailService.send(
          target.email,
          `${target.firstName}, it's ${target.medicationName} o'clock`,
          {
            preheader: `${target.medicationName} — ${target.dosage}`,
            blocks: [
              { kind: 'paragraph', text: "Ding ding! It's time for:" },
              { kind: 'callout', text: `${target.medicationName} — ${target.dosage}` },
              {
                kind: 'paragraph',
                text: "It takes a few seconds, and it's one of the best things you'll do for yourself today.",
              },
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
          `Failed to send medication reminder to=${target.email} medication="${target.medicationName}": ${(err as Error).message}`,
        );
      }
    }
  }
}
