import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { SEND_PATIENT_ONBOARDING_WELCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendPatientOnboardingWelcomeProcessor } from './send-patient-onboarding-welcome.processor';

describe('SendPatientOnboardingWelcomeProcessor', () => {
  let processor: SendPatientOnboardingWelcomeProcessor;
  let mailService: { send: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('https://app.lucencare.test') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendPatientOnboardingWelcomeProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    processor = module.get<SendPatientOnboardingWelcomeProcessor>(SendPatientOnboardingWelcomeProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // Greeting is first-name only — 'Welcome to LucenCare, Ada Lovelace' reads like a form letter.
  it('greets the patient by first name in both the subject and the body', async () => {
    const job = {
      name: SEND_PATIENT_ONBOARDING_WELCOME_JOB,
      data: { to: 'patient@example.com', patientName: 'Ada Lovelace' },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('patient@example.com');
    expect(subject).toBe('Welcome to LucenCare 💚, Ada');
    expect(body).toContain('Hello Ada,');
    expect(body).not.toContain('Lovelace');
  });

  it('links to the patient dashboard on the configured frontend', async () => {
    const job = {
      name: SEND_PATIENT_ONBOARDING_WELCOME_JOB,
      data: { to: 'patient@example.com', patientName: 'Ada Lovelace' },
    } as Job;

    await processor.process(job);

    const [, , body] = mailService.send.mock.calls[0];
    expect(body).toContain('https://app.lucencare.test/patient/dashboard');
  });

  // A mononym must still greet correctly rather than producing 'Hello ,'.
  it('falls back to the whole name when there is only one word', async () => {
    const job = {
      name: SEND_PATIENT_ONBOARDING_WELCOME_JOB,
      data: { to: 'patient@example.com', patientName: 'Ada' },
    } as Job;

    await processor.process(job);

    const [, subject, body] = mailService.send.mock.calls[0];
    expect(subject).toBe('Welcome to LucenCare 💚, Ada');
    expect(body).toContain('Hello Ada,');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
