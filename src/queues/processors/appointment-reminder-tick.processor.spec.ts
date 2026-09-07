import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import {
  MAIL_JOB_OPTIONS,
  APPOINTMENT_REMINDER_TICK_JOB,
  MAIL_QUEUE,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_FAN_OUT_BATCH_SIZE,
  SEND_APPOINTMENT_REMINDER_JOB,
} from 'src/queues/queues.constants';
import { AppointmentsService } from 'src/modules/appointments/appointments.service';

import { AppointmentReminderTickProcessor } from './appointment-reminder-tick.processor';

function target(i: number) {
  return {
    email: `p${i}@example.com`,
    firstName: 'Jane',
    leadMinutes: 60,
    appointmentType: 'consultation',
    appointmentDate: '2026-08-01',
    time: '10:30 AM',
    facility: 'Lucen Health Centre',
    provider: 'Dr. Sarah Chen',
  };
}

describe('AppointmentReminderTickProcessor', () => {
  let processor: AppointmentReminderTickProcessor;
  let appointmentsService: { findDueReminderTargets: jest.Mock };
  let notificationsQueue: Record<string, jest.Mock>;
  let mailQueue: { add: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    appointmentsService = { findDueReminderTargets: jest.fn().mockResolvedValue([]) };
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
        AppointmentReminderTickProcessor,
        { provide: AppointmentsService, useValue: appointmentsService },
        { provide: ConfigService, useValue: configService },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: notificationsQueue },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();

    processor = module.get<AppointmentReminderTickProcessor>(AppointmentReminderTickProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // Keyed on the job name alone, which is what makes a pattern change update the one
  // schedule in place instead of registering a second one that also fires.
  it('registers itself as a job scheduler keyed on the job name', async () => {
    await processor.onModuleInit();

    expect(notificationsQueue.upsertJobScheduler).toHaveBeenCalledWith(
      APPOINTMENT_REMINDER_TICK_JOB,
      { pattern: '*/5 * * * *' },
      { name: APPOINTMENT_REMINDER_TICK_JOB, data: {} },
    );
  });

  it('uses the configured cron pattern when one is set', async () => {
    configService.get.mockReturnValue('*/10 * * * *');

    await processor.onModuleInit();

    expect(notificationsQueue.upsertJobScheduler).toHaveBeenCalledWith(
      APPOINTMENT_REMINDER_TICK_JOB,
      { pattern: '*/10 * * * *' },
      { name: APPOINTMENT_REMINDER_TICK_JOB, data: {} },
    );
  });

  it('enqueues one mail job per batch of targets', async () => {
    appointmentsService.findDueReminderTargets.mockResolvedValue([target(1), target(2)]);

    await processor.process({ name: APPOINTMENT_REMINDER_TICK_JOB } as Job);

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    expect(mailQueue.add).toHaveBeenCalledWith(
      SEND_APPOINTMENT_REMINDER_JOB,
      {
        targets: [target(1), target(2)],
      },
      MAIL_JOB_OPTIONS,
    );
  });

  // One job per patient at scale is what the batch size exists to prevent.
  it('splits a large fan-out into batches rather than one job per target', async () => {
    const targets = Array.from({ length: NOTIFICATION_FAN_OUT_BATCH_SIZE + 5 }, (_, i) =>
      target(i),
    );
    appointmentsService.findDueReminderTargets.mockResolvedValue(targets);

    await processor.process({ name: APPOINTMENT_REMINDER_TICK_JOB } as Job);

    expect(mailQueue.add).toHaveBeenCalledTimes(2);
    expect(mailQueue.add.mock.calls[0][1].targets).toHaveLength(NOTIFICATION_FAN_OUT_BATCH_SIZE);
    expect(mailQueue.add.mock.calls[1][1].targets).toHaveLength(5);
  });

  it('enqueues nothing when no reminders are due', async () => {
    await processor.process({ name: APPOINTMENT_REMINDER_TICK_JOB } as Job);

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('does nothing for a non-matching job name', async () => {
    await processor.process({ name: 'some_other_job' } as unknown as Job);

    expect(appointmentsService.findDueReminderTargets).not.toHaveBeenCalled();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });
});
