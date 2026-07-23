import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { SEND_PATIENT_CREDENTIALS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

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
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
      ],
    }).compile();

    processor = module.get<SendPatientCredentialsProcessor>(SendPatientCredentialsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('patient@example.com');
    expect(subject).toContain('account has been created');
    expect(body).toContain('Ab12Cd34Ef56');
    expect(body).toContain('http://localhost:3001/login');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
