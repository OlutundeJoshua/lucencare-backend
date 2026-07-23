import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import {
  BATCH_NOTIFY_JOB,
  CONSENT_REVOKED_JOB,
  FAN_OUT_NOTIFY_JOB,
  MEDICATION_REFILL_CHECK_JOB,
  MEDICATION_REMINDER_TICK_JOB,
  PROGRAM_APPROVED_JOB,
  STUDY_APPROVED_JOB,
} from 'src/queues/queues.constants';

import { NotificationsQueueProcessor } from './notifications-queue.processor';
import { BatchNotifyProcessor } from './batch-notify.processor';
import { ConsentRevokedProcessor } from './consent-revoked.processor';
import { FanOutNotifyProcessor } from './fan-out-notify.processor';
import { MedicationRefillCheckProcessor } from './medication-refill-check.processor';
import { MedicationReminderTickProcessor } from './medication-reminder-tick.processor';
import { ProgramApprovedProcessor } from './program-approved.processor';
import { StudyApprovedProcessor } from './study-approved.processor';

describe('NotificationsQueueProcessor', () => {
  let processor: NotificationsQueueProcessor;
  let fanOutNotifyProcessor: { process: jest.Mock };
  let batchNotifyProcessor: { process: jest.Mock };
  let consentRevokedProcessor: { process: jest.Mock };
  let programApprovedProcessor: { process: jest.Mock };
  let studyApprovedProcessor: { process: jest.Mock };
  let medicationRefillCheckProcessor: { process: jest.Mock };
  let medicationReminderTickProcessor: { process: jest.Mock };

  beforeEach(async () => {
    fanOutNotifyProcessor = { process: jest.fn() };
    batchNotifyProcessor = { process: jest.fn() };
    consentRevokedProcessor = { process: jest.fn() };
    programApprovedProcessor = { process: jest.fn() };
    studyApprovedProcessor = { process: jest.fn() };
    medicationRefillCheckProcessor = { process: jest.fn() };
    medicationReminderTickProcessor = { process: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsQueueProcessor,
        { provide: FanOutNotifyProcessor, useValue: fanOutNotifyProcessor },
        { provide: BatchNotifyProcessor, useValue: batchNotifyProcessor },
        { provide: ConsentRevokedProcessor, useValue: consentRevokedProcessor },
        { provide: ProgramApprovedProcessor, useValue: programApprovedProcessor },
        { provide: StudyApprovedProcessor, useValue: studyApprovedProcessor },
        { provide: MedicationRefillCheckProcessor, useValue: medicationRefillCheckProcessor },
        { provide: MedicationReminderTickProcessor, useValue: medicationReminderTickProcessor },
      ],
    }).compile();

    processor = module.get<NotificationsQueueProcessor>(NotificationsQueueProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('routes fan_out_notify jobs to FanOutNotifyProcessor', async () => {
    const job = { name: FAN_OUT_NOTIFY_JOB, data: {} } as Job;
    await processor.process(job);
    expect(fanOutNotifyProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes batch_notify jobs to BatchNotifyProcessor', async () => {
    const job = { name: BATCH_NOTIFY_JOB, data: {} } as Job;
    await processor.process(job);
    expect(batchNotifyProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes consent_revoked jobs to ConsentRevokedProcessor', async () => {
    const job = { name: CONSENT_REVOKED_JOB, data: {} } as Job;
    await processor.process(job);
    expect(consentRevokedProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes program_approved jobs to ProgramApprovedProcessor', async () => {
    const job = { name: PROGRAM_APPROVED_JOB, data: {} } as Job;
    await processor.process(job);
    expect(programApprovedProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes study_approved jobs to StudyApprovedProcessor', async () => {
    const job = { name: STUDY_APPROVED_JOB, data: {} } as Job;
    await processor.process(job);
    expect(studyApprovedProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes medication_refill_check jobs to MedicationRefillCheckProcessor', async () => {
    const job = { name: MEDICATION_REFILL_CHECK_JOB, data: {} } as Job;
    await processor.process(job);
    expect(medicationRefillCheckProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes medication_reminder_tick jobs to MedicationReminderTickProcessor', async () => {
    const job = { name: MEDICATION_REMINDER_TICK_JOB, data: {} } as Job;
    await processor.process(job);
    expect(medicationReminderTickProcessor.process).toHaveBeenCalledWith(job);
  });

  it('does nothing for an unrecognized job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;
    await processor.process(job);
    expect(fanOutNotifyProcessor.process).not.toHaveBeenCalled();
    expect(batchNotifyProcessor.process).not.toHaveBeenCalled();
    expect(consentRevokedProcessor.process).not.toHaveBeenCalled();
    expect(programApprovedProcessor.process).not.toHaveBeenCalled();
    expect(studyApprovedProcessor.process).not.toHaveBeenCalled();
    expect(medicationRefillCheckProcessor.process).not.toHaveBeenCalled();
    expect(medicationReminderTickProcessor.process).not.toHaveBeenCalled();
  });
});
