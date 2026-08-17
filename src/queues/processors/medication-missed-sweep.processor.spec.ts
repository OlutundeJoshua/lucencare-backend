import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { MEDICATION_MISSED_SWEEP_JOB, NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { MedicationsService } from 'src/modules/medications/medications.service';

import { MedicationMissedSweepProcessor } from './medication-missed-sweep.processor';

describe('MedicationMissedSweepProcessor', () => {
  let processor: MedicationMissedSweepProcessor;
  let medicationsService: { markOverdueDosesMissed: jest.Mock };
  let notificationsQueue: { add: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    medicationsService = { markOverdueDosesMissed: jest.fn().mockResolvedValue(0) };
    notificationsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn((_key: string, fallback: string) => fallback) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicationMissedSweepProcessor,
        { provide: MedicationsService, useValue: medicationsService },
        { provide: ConfigService, useValue: configService },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: notificationsQueue },
      ],
    }).compile();

    processor = module.get<MedicationMissedSweepProcessor>(MedicationMissedSweepProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // The fixed jobId is what makes re-registration idempotent across restarts —
  // without it every boot would add another repeatable schedule.
  it('registers itself as a repeatable job with a fixed jobId', async () => {
    await processor.onModuleInit();

    expect(notificationsQueue.add).toHaveBeenCalledWith(
      MEDICATION_MISSED_SWEEP_JOB,
      {},
      { repeat: { pattern: '*/15 * * * *' }, jobId: MEDICATION_MISSED_SWEEP_JOB },
    );
  });

  it('uses the configured cron pattern when one is set', async () => {
    configService.get.mockReturnValue('*/5 * * * *');

    await processor.onModuleInit();

    expect(notificationsQueue.add).toHaveBeenCalledWith(
      MEDICATION_MISSED_SWEEP_JOB,
      {},
      expect.objectContaining({ repeat: { pattern: '*/5 * * * *' } }),
    );
  });

  it('delegates the sweep to MedicationsService', async () => {
    medicationsService.markOverdueDosesMissed.mockResolvedValue(3);

    await processor.process({ name: MEDICATION_MISSED_SWEEP_JOB } as Job);

    expect(medicationsService.markOverdueDosesMissed).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a non-matching job name', async () => {
    await processor.process({ name: 'some_other_job' } as unknown as Job);

    expect(medicationsService.markOverdueDosesMissed).not.toHaveBeenCalled();
  });
});
