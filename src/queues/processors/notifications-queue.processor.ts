import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  BATCH_NOTIFY_JOB,
  CONSENT_REVOKED_JOB,
  FAN_OUT_NOTIFY_JOB,
  MEDICATION_REFILL_CHECK_JOB,
  MEDICATION_REMINDER_TICK_JOB,
  NOTIFICATIONS_QUEUE,
  STUDY_APPROVED_JOB,
  WORKER_POLL_OPTIONS,
} from 'src/queues/queues.constants';

import { BatchNotifyProcessor } from './batch-notify.processor';
import { ConsentRevokedProcessor } from './consent-revoked.processor';
import { FanOutNotifyProcessor } from './fan-out-notify.processor';
import { MedicationRefillCheckProcessor } from './medication-refill-check.processor';
import { MedicationReminderTickProcessor } from './medication-reminder-tick.processor';
import { StudyApprovedProcessor } from './study-approved.processor';

// PROGRAM_APPROVED_JOB used to be routed here while AdminService enqueued it on
// ADMIN_QUEUE — so it matched nothing, and removeOnComplete threw it away. Both
// programme outcome jobs now live with their producer, in AdminQueueProcessor.
@Processor(NOTIFICATIONS_QUEUE, WORKER_POLL_OPTIONS)
export class NotificationsQueueProcessor extends WorkerHost {
  constructor(
    private readonly fanOutNotifyProcessor: FanOutNotifyProcessor,
    private readonly batchNotifyProcessor: BatchNotifyProcessor,
    private readonly consentRevokedProcessor: ConsentRevokedProcessor,
    private readonly studyApprovedProcessor: StudyApprovedProcessor,
    private readonly medicationRefillCheckProcessor: MedicationRefillCheckProcessor,
    private readonly medicationReminderTickProcessor: MedicationReminderTickProcessor,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case FAN_OUT_NOTIFY_JOB:
        return this.fanOutNotifyProcessor.process(job);
      case BATCH_NOTIFY_JOB:
        return this.batchNotifyProcessor.process(job);
      case CONSENT_REVOKED_JOB:
        return this.consentRevokedProcessor.process(job);
      case STUDY_APPROVED_JOB:
        return this.studyApprovedProcessor.process(job);
      case MEDICATION_REFILL_CHECK_JOB:
        return this.medicationRefillCheckProcessor.process(job);
      case MEDICATION_REMINDER_TICK_JOB:
        return this.medicationReminderTickProcessor.process(job);
      default:
        return;
    }
  }
}
