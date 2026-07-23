import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { SEND_PATIENT_ONBOARDING_WELCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendPatientOnboardingWelcomeProcessor } from './send-patient-onboarding-welcome.processor';

describe('SendPatientOnboardingWelcomeProcessor', () => {
  let processor: SendPatientOnboardingWelcomeProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SendPatientOnboardingWelcomeProcessor, { provide: MailService, useValue: mailService }],
    }).compile();

    processor = module.get<SendPatientOnboardingWelcomeProcessor>(SendPatientOnboardingWelcomeProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends a welcome email addressed to the patient by name', async () => {
    const job = {
      name: SEND_PATIENT_ONBOARDING_WELCOME_JOB,
      data: { to: 'patient@example.com', patientName: 'Ada Lovelace' },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('patient@example.com');
    expect(subject).toContain('Welcome to LucenCare');
    expect(body).toContain('Ada Lovelace');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
