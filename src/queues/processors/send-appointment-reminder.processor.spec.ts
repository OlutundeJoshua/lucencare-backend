import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { AppointmentReminderLead } from 'src/common/enums';
import { SEND_APPOINTMENT_REMINDER_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { renderEmailText } from 'src/modules/mail/email-text.util';
import { SendAppointmentReminderJob } from 'src/queues/interfaces/send-appointment-reminder-job.interface';

import { SendAppointmentReminderProcessor } from './send-appointment-reminder.processor';

function target(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'jane@example.com',
    firstName: 'Jane',
    lead: AppointmentReminderLead.ONE_DAY,
    appointmentType: 'consultation',
    appointmentDate: '2026-08-01',
    time: '10:30 AM',
    facility: 'Lucen Health Centre, Lagos',
    provider: 'Dr. Sarah Chen',
    ...overrides,
  };
}

function jobFor(targets: unknown[]) {
  return {
    name: SEND_APPOINTMENT_REMINDER_JOB,
    data: { targets },
  } as Job<SendAppointmentReminderJob>;
}

describe('SendAppointmentReminderProcessor', () => {
  let processor: SendAppointmentReminderProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendAppointmentReminderProcessor,
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    processor = module.get<SendAppointmentReminderProcessor>(SendAppointmentReminderProcessor);
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

  it('lists every appointment detail in the body', async () => {
    await processor.process(jobFor([target()]));

    const [to, subject, body] = sent();
    expect(to).toBe('jane@example.com');
    expect(subject).toBe("Psst, Jane — you've got an appointment tomorrow!");
    expect(body).toContain('Hey Jane,');
    expect(body).toContain("You've got an appointment tomorrow.");
    expect(body).toContain('Type: consultation');
    expect(body).toContain('Date: 2026-08-01');
    expect(body).toContain('Time: 10:30 AM');
    expect(body).toContain('Location: Lucen Health Centre, Lagos');
    expect(body).toContain('With: Dr. Sarah Chen');
  });

  it('uses the one-hour copy for the one-hour lead', async () => {
    await processor.process(jobFor([target({ lead: AppointmentReminderLead.ONE_HOUR })]));

    const [, subject, body] = sent();
    expect(subject).toBe('Jane, your appointment is in an hour');
    expect(body).toContain("You've got an appointment in 1 hour.");
    expect(body).toContain('60-second prep list');
  });

  // A job enqueued just before a deploy that changed the lead set carries a lead this
  // build no longer knows. It must not take the rest of the batch down with it.
  it('skips a target whose lead this build no longer knows, and sends the rest', async () => {
    await processor.process(
      jobFor([
        target({ email: 'stale@example.com', lead: 'thirty_minutes' }),
        target({ email: 'jane@example.com' }),
      ]),
    );

    expect(mailService.send).toHaveBeenCalledTimes(1);
    expect(mailService.send.mock.calls[0][0]).toBe('jane@example.com');
  });

  // A prep checklist arriving as someone walks in reads as pressure, not help — there
  // is no longer time to act on it.
  it('drops the prep list on the at-time reminder', async () => {
    await processor.process(jobFor([target({ lead: AppointmentReminderLead.AT_TIME })]));

    const [, subject, body] = sent();
    expect(subject).toBe("Jane, it's appointment time");
    expect(body).toContain('Your appointment starts now.');
    expect(body).not.toContain('prep list');
  });

  it('sends one email per target in the batch', async () => {
    await processor.process(
      jobFor([target(), target({ email: 'ada@example.com', firstName: 'Ada' })]),
    );

    expect(mailService.send).toHaveBeenCalledTimes(2);
    expect(mailService.send.mock.calls[1][0]).toBe('ada@example.com');
  });

  it('continues sending to remaining targets when one send fails', async () => {
    mailService.send
      .mockRejectedValueOnce(new Error('SMTP rejected recipient'))
      .mockResolvedValueOnce(undefined);

    await processor.process(
      jobFor([target({ email: 'bad@example.com' }), target({ email: 'ada@example.com' })]),
    );

    expect(mailService.send).toHaveBeenCalledTimes(2);
    expect(mailService.send.mock.calls[1][0]).toBe('ada@example.com');
  });

  describe('email structure', () => {
    const contentOf = (): EmailContent => mailService.send.mock.calls[0][2];

    it('lays the appointment out as an introduced detail table', async () => {
      await processor.process(jobFor([target()]));

      const rows = contentOf().blocks.find((block) => block.kind === 'detailRows');
      expect(rows).toMatchObject({
        kind: 'detailRows',
        lead: 'Appointment details:',
      });
      expect(rows && 'rows' in rows ? rows.rows.map((r) => r.label) : []).toEqual([
        'Type',
        'Date',
        'Time',
        'Location',
        'With',
      ]);
    });

    it('makes the lead-time line a callout', async () => {
      await processor.process(jobFor([target()]));

      expect(contentOf().blocks.map((block) => block.kind)).toContain('callout');
    });
  });

  it('does nothing for a non-matching job name', async () => {
    const job = {
      name: 'some_other_job',
      data: { targets: [target()] },
    } as unknown as Job<SendAppointmentReminderJob>;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
