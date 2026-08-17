import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';

import {
  MEDICATION_MISSED_SWEEP_JOB,
  NOTIFICATIONS_QUEUE,
} from 'src/queues/queues.constants';
import { MedicationsService } from 'src/modules/medications/medications.service';

/**
 * Persists MISSED on doses whose grace period elapsed with nothing logged. Without it a
 * dose stays PENDING forever: the patient's own log endpoint is the only other writer,
 * and a dose nobody logged is precisely the one nobody called it for.
 *
 * The sweep never marks a dose early — it only ever acts on doses already past grace —
 * so the tick interval trades persistence latency against Redis bookkeeping, nothing more.
 */
@Injectable()
export class MedicationMissedSweepProcessor implements OnModuleInit {
  private readonly logger = new Logger(MedicationMissedSweepProcessor.name);

  constructor(
    private readonly medicationsService: MedicationsService,
    private readonly configService: ConfigService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const pattern = this.configService.get<string>(
      'app.medicationMissedSweepCron',
      '*/15 * * * *',
    );
    await this.notificationsQueue.add(
      MEDICATION_MISSED_SWEEP_JOB,
      {},
      { repeat: { pattern }, jobId: MEDICATION_MISSED_SWEEP_JOB },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MEDICATION_MISSED_SWEEP_JOB) return;

    const marked = await this.medicationsService.markOverdueDosesMissed();
    if (marked > 0) {
      this.logger.log(`Marked ${marked} overdue dose(s) as missed`);
    }
  }
}
