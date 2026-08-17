import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';

import {
  APPOINTMENT_REMINDER_TICK_JOB,
  MAIL_QUEUE,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
  SEND_APPOINTMENT_REMINDER_JOB,
} from 'src/queues/queues.constants';
import { AppointmentsService } from 'src/modules/appointments/appointments.service';

/**
 * Finds appointments coming due and fans out reminder emails, mirroring
 * medication-reminder-tick.processor.ts. Separate from the booking confirmation, which
 * fires once when the appointment is created or rescheduled: that one cannot say
 * "in 3 days" because at booking time the appointment may be weeks away.
 */
@Injectable()
export class AppointmentReminderTickProcessor implements OnModuleInit {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly configService: ConfigService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const pattern = this.configService.get<string>(
      'app.appointmentReminderTickCron',
      '*/5 * * * *',
    );
    await this.notificationsQueue.add(
      APPOINTMENT_REMINDER_TICK_JOB,
      {},
      { repeat: { pattern }, jobId: APPOINTMENT_REMINDER_TICK_JOB },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== APPOINTMENT_REMINDER_TICK_JOB) return;

    const targets = await this.appointmentsService.findDueReminderTargets();
    for (const batch of chunkArray(targets, NOTIFICATION_FAN_OUT_BATCH_SIZE)) {
      await this.mailQueue.add(SEND_APPOINTMENT_REMINDER_JOB, { targets: batch });
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
