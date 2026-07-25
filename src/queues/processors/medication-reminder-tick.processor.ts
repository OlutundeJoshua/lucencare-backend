import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import {
  MAIL_QUEUE,
  MEDICATION_REMINDER_TICK_CRON,
  MEDICATION_REMINDER_TICK_JOB,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
  SEND_MEDICATION_REMINDER_EMAIL_JOB,
} from 'src/queues/queues.constants';
import { MedicationsService } from 'src/modules/medications/medications.service';

@Injectable()
export class MedicationReminderTickProcessor implements OnModuleInit {
  constructor(
    private readonly medicationsService: MedicationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.notificationsQueue.add(
      MEDICATION_REMINDER_TICK_JOB,
      {},
      { repeat: { pattern: MEDICATION_REMINDER_TICK_CRON }, jobId: MEDICATION_REMINDER_TICK_JOB },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MEDICATION_REMINDER_TICK_JOB) return;

    const targets = await this.medicationsService.findDueReminderTargets();
    for (const batch of chunkArray(targets, NOTIFICATION_FAN_OUT_BATCH_SIZE)) {
      await this.mailQueue.add(SEND_MEDICATION_REMINDER_EMAIL_JOB, { targets: batch });
    }
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
