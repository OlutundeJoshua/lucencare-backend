import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';

import {
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  MEDICATION_REMINDER_TICK_JOB,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
  SEND_MEDICATION_REMINDER_EMAIL_JOB,
} from 'src/queues/queues.constants';
import { MedicationsService } from 'src/modules/medications/medications.service';

import { MedicationReminderTickProcessor } from './medication-reminder-tick.processor';

/** One grouped reminder target, as findDueReminderTargets returns them. */
function target(n: number) {
  return {
    email: `p${n}@example.com`,
    firstName: `P${n}`,
    leadMinutes: 30,
    scheduledTime: '8:00 AM',
    medications: [{ name: 'Metformin', dosage: '500mg' }],
    streakDays: 3,
  };
}

describe('MedicationReminderTickProcessor', () => {
  let processor: MedicationReminderTickProcessor;
  let medicationsService: { findDueReminderTargets: jest.Mock };
  let notificationsQueue: Record<string, jest.Mock>;
  let mailQueue: { add: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    medicationsService = { findDueReminderTargets: jest.fn().mockResolvedValue([]) };
    notificationsQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
    };
    mailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn((_key: string, fallback: string) => fallback) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicationReminderTickProcessor,
        { provide: MedicationsService, useValue: medicationsService },
        { provide: ConfigService, useValue: configService },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: notificationsQueue },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();

    processor = module.get(MedicationReminderTickProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('registration', () => {
    // Keyed on the job name alone. A repeatable job's key encodes its cron pattern, so
    // registering by pattern left the old schedule firing after a pattern change — and
    // two live schedules mean every reminder goes out twice.
    it('registers itself as a job scheduler keyed on the job name', async () => {
      await processor.onModuleInit();

      expect(notificationsQueue.upsertJobScheduler).toHaveBeenCalledWith(
        MEDICATION_REMINDER_TICK_JOB,
        { pattern: '*/5 * * * *' },
        { name: MEDICATION_REMINDER_TICK_JOB, data: {} },
      );
    });

    it('uses the configured cron pattern when one is set', async () => {
      configService.get.mockReturnValue('*/10 * * * *');

      await processor.onModuleInit();

      expect(notificationsQueue.upsertJobScheduler).toHaveBeenCalledWith(
        MEDICATION_REMINDER_TICK_JOB,
        { pattern: '*/10 * * * *' },
        { name: MEDICATION_REMINDER_TICK_JOB, data: {} },
      );
    });

    it('clears a schedule left behind by an earlier pattern', async () => {
      notificationsQueue.getRepeatableJobs.mockResolvedValue([
        {
          name: MEDICATION_REMINDER_TICK_JOB,
          key: 'hash-of-30-minute-pattern',
          pattern: '*/30 * * * *',
        },
      ]);

      await processor.onModuleInit();

      expect(notificationsQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        'hash-of-30-minute-pattern',
      );
    });

    it('adds nothing on a restart with an unchanged pattern', async () => {
      notificationsQueue.getRepeatableJobs.mockResolvedValue([
        {
          name: MEDICATION_REMINDER_TICK_JOB,
          key: MEDICATION_REMINDER_TICK_JOB,
          pattern: '*/5 * * * *',
        },
      ]);

      await processor.onModuleInit();

      expect(notificationsQueue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(notificationsQueue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });
  });

  describe('process', () => {
    it('does nothing for a non-matching job name', async () => {
      await processor.process({ name: 'some_other_job' } as Job);

      expect(medicationsService.findDueReminderTargets).not.toHaveBeenCalled();
      expect(mailQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues nothing when no reminders are due', async () => {
      await processor.process({ name: MEDICATION_REMINDER_TICK_JOB } as Job);

      expect(mailQueue.add).not.toHaveBeenCalled();
    });

    // The retry policy has to be passed per call site: without it BullMQ defaults to a
    // single attempt, so one transient SMTP failure loses a whole batch of reminders.
    it('enqueues one mail job per batch, with the retry policy', async () => {
      medicationsService.findDueReminderTargets.mockResolvedValue([target(1), target(2)]);

      await processor.process({ name: MEDICATION_REMINDER_TICK_JOB } as Job);

      expect(mailQueue.add).toHaveBeenCalledTimes(1);
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_MEDICATION_REMINDER_EMAIL_JOB,
        { targets: [target(1), target(2)] },
        MAIL_JOB_OPTIONS,
      );
    });

    // One job per patient at scale is what the batch size exists to prevent.
    it('splits a large fan-out into batches rather than one job per target', async () => {
      const targets = Array.from({ length: NOTIFICATION_FAN_OUT_BATCH_SIZE + 1 }, (_, i) =>
        target(i),
      );
      medicationsService.findDueReminderTargets.mockResolvedValue(targets);

      await processor.process({ name: MEDICATION_REMINDER_TICK_JOB } as Job);

      expect(mailQueue.add).toHaveBeenCalledTimes(2);
      expect(mailQueue.add.mock.calls[0][1].targets).toHaveLength(NOTIFICATION_FAN_OUT_BATCH_SIZE);
      expect(mailQueue.add.mock.calls[1][1].targets).toHaveLength(1);
    });
  });
});
