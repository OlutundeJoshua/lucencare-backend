import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { SEND_MEDICATION_REMINDER_EMAIL_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { renderEmailText } from 'src/modules/mail/email-text.util';
import { SendMedicationReminderEmailJob } from 'src/queues/interfaces/send-medication-reminder-email-job.interface';

import { SendMedicationReminderEmailProcessor } from './send-medication-reminder-email.processor';

function target(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'a@example.com',
    firstName: 'Ada',
    medicationName: 'Amlodipine',
    dosage: '5mg',
    scheduledTime: '8:00 AM',
    streakDays: 4,
    ...overrides,
  };
}

describe('SendMedicationReminderEmailProcessor', () => {
  let processor: SendMedicationReminderEmailProcessor;
  let mailService: { send: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('https://app.lucencare.test') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendMedicationReminderEmailProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    processor = module.get<SendMedicationReminderEmailProcessor>(
      SendMedicationReminderEmailProcessor,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * The [to, subject, plain-text body] of the i-th email sent. The processor now hands
   * MailService a structured EmailContent, so the body is rendered back to text here —
   * which is what the copy assertions below are about.
   */
  const sent = (i = 0): [string, string, string] => {
    const [to, subject, content] = mailService.send.mock.calls[i];
    return [to, subject, renderEmailText(content)];
  };

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends a reminder email for every target in the batch', async () => {
    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: {
        targets: [
          target(),
          target({
            email: 'b@example.com',
            firstName: 'Grace',
            medicationName: 'Metformin',
            dosage: '500mg',
          }),
        ],
      },
    } as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(2);
    expect(mailService.send.mock.calls[0][0]).toBe('a@example.com');
    expect(mailService.send.mock.calls[1][0]).toBe('b@example.com');
  });

  it('names the patient and their medication in the subject', async () => {
    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: { targets: [target()] },
    } as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    const [, subject, body] = sent();
    expect(subject).toBe("Ada, it's Amlodipine o'clock");
    expect(body).toContain('Amlodipine — 5mg');
    expect(body).toContain('https://app.lucencare.test/patient/medications/schedule');
  });

  it('includes the streak line when the patient has a streak going', async () => {
    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: { targets: [target({ streakDays: 12 })] },
    } as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    expect(sent()[2]).toContain('12 day streak');
  });

  // "You're currently on a 0 day streak" opens a nudge by telling someone they have
  // nothing going — the line is dropped rather than printed with a zero.
  it('drops the streak line entirely at zero rather than saying "0 day streak"', async () => {
    const job = {
      name: SEND_MEDICATION_REMINDER_EMAIL_JOB,
      data: { targets: [target({ streakDays: 0 })] },
    } as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    const body = sent()[2];
    expect(body).not.toContain('streak');
    expect(body).toContain('Tap here to mark it done');
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
          target({ email: 'bad@example.com' }),
          target({ email: 'b@example.com', medicationName: 'Metformin' }),
          target({ email: 'c@example.com', medicationName: 'Lisinopril' }),
        ],
      },
    } as Job<SendMedicationReminderEmailJob>;

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(mailService.send).toHaveBeenCalledTimes(3);
    expect(mailService.send.mock.calls[1][0]).toBe('b@example.com');
    expect(mailService.send.mock.calls[2][0]).toBe('c@example.com');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = {
      name: 'some_other_job',
      data: { targets: [] },
    } as unknown as Job<SendMedicationReminderEmailJob>;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
