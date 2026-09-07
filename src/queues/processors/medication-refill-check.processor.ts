import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { NotificationType } from 'src/common/enums';
import {
  MEDICATION_REFILL_CHECK_CRON,
  MEDICATION_REFILL_CHECK_JOB,
  NOTIFICATIONS_QUEUE,
} from 'src/queues/queues.constants';
import { MedicationsService } from 'src/modules/medications/medications.service';
import { scheduleRepeatable } from 'src/queues/schedule-repeatable.util';
import { NotificationsService } from 'src/modules/notifications/notifications.service';

@Injectable()
export class MedicationRefillCheckProcessor implements OnModuleInit {
  private readonly logger = new Logger(MedicationRefillCheckProcessor.name);

  constructor(
    private readonly medicationsService: MedicationsService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await scheduleRepeatable(
      this.notificationsQueue,
      MEDICATION_REFILL_CHECK_JOB,
      MEDICATION_REFILL_CHECK_CRON,
      this.logger,
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MEDICATION_REFILL_CHECK_JOB) return;

    const targets = await this.medicationsService.findMedicationsNeedingRefillAlert();
    for (const target of targets) {
      await this.notificationsService.createOne(target.userId, NotificationType.REFILL_ALERT, {
        medicationId: target.medicationId,
        medicationName: target.medicationName,
        urgency: target.urgency,
        source: 'cron',
      });
    }
  }
}
