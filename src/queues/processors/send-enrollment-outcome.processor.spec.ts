import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EnrollmentStatus } from 'src/common/enums';
import { SEND_ENROLLMENT_OUTCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendEnrollmentOutcomeProcessor } from './send-enrollment-outcome.processor';

const FRONTEND_URL = 'http://localhost:3001';

describe('SendEnrollmentOutcomeProcessor', () => {
  let processor: SendEnrollmentOutcomeProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendEnrollmentOutcomeProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(FRONTEND_URL) } },
      ],
    }).compile();

    processor = module.get(SendEnrollmentOutcomeProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  async function run(status: EnrollmentStatus, reason?: string): Promise<[string, string, string]> {
    await processor.process({
      name: SEND_ENROLLMENT_OUTCOME_JOB,
      data: {
        to: 'patient@example.com',
        patientName: 'Ada Obi',
        programTitle: 'Chronic Care Fund',
        status,
        reason,
      },
    } as Job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    return mailService.send.mock.calls[0] as [string, string, string];
  }

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('does nothing for a non-matching job name', async () => {
    await processor.process({ name: 'some_other_job', data: {} } as Job);
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('tells a selected applicant the good news', async () => {
    const [to, subject, body] = await run(EnrollmentStatus.SELECTED);

    expect(to).toBe('patient@example.com');
    expect(subject).toContain('selected for Chronic Care Fund');
    expect(body).toContain('Ada Obi');
    expect(body).toContain(`${FRONTEND_URL}/patient/funding/plans`);
    expect(body).toContain('The LucenCare Team');
  });

  it('explains the waiting list without implying a decision', async () => {
    const [, subject, body] = await run(EnrollmentStatus.WAITLISTED);

    expect(subject).toContain('waiting list');
    expect(body).toContain('nothing else you need to do');
  });

  it('includes the reason on a rejection', async () => {
    const [, subject, body] = await run(
      EnrollmentStatus.REJECTED,
      'Household income above the threshold',
    );

    expect(subject).toContain('was not successful');
    expect(body).toContain('Reason: Household income above the threshold');
    expect(body).toContain('apply to other programmes');
  });

  // The API requires a reason on reject, but a missing one must never reach the
  // patient as "Reason: undefined".
  it('omits the reason line entirely when none was given', async () => {
    const [, , body] = await run(EnrollmentStatus.REJECTED, undefined);

    expect(body).not.toContain('Reason:');
    expect(body).not.toContain('undefined');
  });

  it('never leaks a placeholder for any outcome', async () => {
    for (const status of [
      EnrollmentStatus.SELECTED,
      EnrollmentStatus.WAITLISTED,
      EnrollmentStatus.REJECTED,
    ]) {
      mailService.send.mockClear();
      const [, subject, body] = await run(status, 'a reason');
      expect(subject).not.toContain('undefined');
      expect(body).not.toContain('undefined');
    }
  });
});
