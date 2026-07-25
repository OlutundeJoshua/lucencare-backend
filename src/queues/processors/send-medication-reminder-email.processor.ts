import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { SEND_MEDICATION_REMINDER_EMAIL_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendMedicationReminderEmailJob } from 'src/queues/interfaces/send-medication-reminder-email-job.interface';

@Injectable()
export class SendMedicationReminderEmailProcessor {
  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendMedicationReminderEmailJob>): Promise<void> {
    if (job.name !== SEND_MEDICATION_REMINDER_EMAIL_JOB) return;

    for (const target of job.data.targets) {
      await this.mailService.send(
        target.email,
        'Time to take your medication',
        `Hello,\n\nThis is a reminder to take ${target.medicationName} (${target.dosage}), scheduled for ${target.scheduledTime}.\n\nStaying on schedule helps you get the most out of your treatment.\n\nThe LucenCare Team`,
      );
    }
  }
}
