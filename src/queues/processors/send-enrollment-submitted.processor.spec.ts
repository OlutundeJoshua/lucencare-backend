import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { SEND_ENROLLMENT_SUBMITTED_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { renderEmailText } from 'src/modules/mail/email-text.util';

import { SendEnrollmentSubmittedProcessor } from './send-enrollment-submitted.processor';

const FRONTEND_URL = 'http://localhost:3001';

describe('SendEnrollmentSubmittedProcessor', () => {
  let processor: SendEnrollmentSubmittedProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendEnrollmentSubmittedProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(FRONTEND_URL) } },
      ],
    }).compile();

    processor = module.get(SendEnrollmentSubmittedProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  async function run(): Promise<[string, string, string]> {
    await processor.process({
      name: SEND_ENROLLMENT_SUBMITTED_JOB,
      data: {
        to: 'patient@example.com',
        patientName: 'Ada Obi',
        programTitle: 'Chronic Care Fund',
      },
    } as Job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, content] = mailService.send.mock.calls[0];
    return [to, subject, renderEmailText(content)];
  }

  const contentOf = (): EmailContent => mailService.send.mock.calls[0][2];

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('does nothing for a non-matching job name', async () => {
    await processor.process({ name: 'some_other_job', data: {} } as Job);

    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('acknowledges the application to the patient', async () => {
    const [to, subject, body] = await run();

    expect(to).toBe('patient@example.com');
    expect(subject).toBe('We have received your application to Chronic Care Fund');
    expect(body).toContain('Hi Ada Obi,');
    expect(body).toContain('Your application to Chronic Care Fund has been submitted.');
    expect(body).toContain('The programme team will review it');
    expect(body).toContain('You will get an email as soon as a decision has been made.');
    expect(body).toContain('The LucenCare Team');
  });

  // The one link worth giving them: where the status of this application lives.
  it('links to the applications tab, not the browse tab', async () => {
    const [, , body] = await run();

    expect(body).toContain(`View your applications: ${FRONTEND_URL}/patient/funding/plans`);
  });

  it('sets a preheader so the inbox snippet says what happens next', async () => {
    await run();

    expect(contentOf().preheader).toBe(
      'You will hear from us as soon as a decision has been made.',
    );
  });

  // House style: no em dashes in the outgoing copy.
  it('uses no em dash anywhere in the email', async () => {
    const [, subject, body] = await run();

    expect(subject).not.toContain('—');
    expect(body).not.toContain('—');
  });

  it('never leaks a placeholder into the copy', async () => {
    const [, subject, body] = await run();

    expect(subject).not.toContain('undefined');
    expect(body).not.toContain('undefined');
  });
});
