import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { SEND_MEDICATION_REMINDER_EMAIL_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendMedicationReminderEmailJob } from 'src/queues/interfaces/send-medication-reminder-email-job.interface';

import { SendMedicationReminderEmailProcessor } from './send-medication-reminder-email.processor';

describe('SendMedicationReminderEmailProcessor', () => {
  let processor: SendMedicationReminderEmailProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendMedicationReminderEmailProcessor,
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    processor = module.get<SendMedicationReminderEmailProcessor>(SendMedicationReminderEmailProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends a reminder email for every target in the batch', async () => {
    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: {
        targets: [
          { email: 'a@example.com', medicationName: 'Amlodipine', dosage: '5mg', scheduledTime: '8:00 AM' },
          { email: 'b@example.com', medicationName: 'Metformin', dosage: '500mg', scheduledTime: '8:00 AM' },
        ],
      },
    } as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(2);
    expect(mailService.send).toHaveBeenNthCalledWith(
      1,
      'a@example.com',
      'Time to take your medication',
      expect.stringContaining('Amlodipine (5mg)'),
    );
    expect(mailService.send).toHaveBeenNthCalledWith(
      2,
      'b@example.com',
      'Time to take your medication',
      expect.stringContaining('Metformin (500mg)'),
    );
  });

  it('continues sending to remaining targets when one send fails', async () => {
    mailService.send
      .mockRejectedValueOnce(new Error('SMTP rejected recipient'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: {
        targets: [
          { email: 'bad@example.com', medicationName: 'Amlodipine', dosage: '5mg', scheduledTime: '8:00 AM' },
          { email: 'b@example.com', medicationName: 'Metformin', dosage: '500mg', scheduledTime: '8:00 AM' },
          { email: 'c@example.com', medicationName: 'Lisinopril', dosage: '10mg', scheduledTime: '8:00 AM' },
        ],
      },
    } as Job<SendMedicationReminderEmailJob>;

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(mailService.send).toHaveBeenCalledTimes(3);
    expect(mailService.send).toHaveBeenNthCalledWith(
      2,
      'b@example.com',
      'Time to take your medication',
      expect.any(String),
    );
    expect(mailService.send).toHaveBeenNthCalledWith(
      3,
      'c@example.com',
      'Time to take your medication',
      expect.any(String),
    );
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: { targets: [] } } as unknown as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
