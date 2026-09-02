import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { SEND_PATIENT_CREDENTIALS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { renderEmailText } from 'src/modules/mail/email-text.util';

import { SendPatientCredentialsProcessor } from './send-patient-credentials.processor';

describe('SendPatientCredentialsProcessor', () => {
  let processor: SendPatientCredentialsProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendPatientCredentialsProcessor,
        { provide: MailService, useValue: mailService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') },
        },
      ],
    }).compile();

    processor = module.get<SendPatientCredentialsProcessor>(SendPatientCredentialsProcessor);
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

  it('sends an account-created email with the temp password and login link', async () => {
    const job = {
      name: SEND_PATIENT_CREDENTIALS_JOB,
      data: { to: 'patient@example.com', tempPassword: 'Ab12Cd34Ef56' },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sent();
    expect(to).toBe('patient@example.com');
    expect(subject).toContain('account has been created');
    expect(body).toContain('Ab12Cd34Ef56');
    expect(body).toContain('http://localhost:3001/login');
  });

  describe('email structure', () => {
    const contentOf = (): EmailContent => mailService.send.mock.calls[0][2];

    async function send() {
      await processor.process({
        name: SEND_PATIENT_CREDENTIALS_JOB,
        data: { to: 'patient@example.com', tempPassword: 'Temp-1234' },
      } as Job);
    }

    it('lays the credentials out as label/value rows', async () => {
      await send();

      expect(contentOf().blocks).toContainEqual({
        kind: 'detailRows',
        rows: [
          { label: 'Email', value: 'patient@example.com' },
          { label: 'Temporary password', value: 'Temp-1234' },
        ],
      });
    });

    // The preheader is visible without opening the email.
    it('keeps the temporary password out of the preheader', async () => {
      await send();

      expect(contentOf().preheader).not.toContain('Temp-1234');
    });
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
