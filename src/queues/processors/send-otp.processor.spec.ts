import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { SEND_OTP_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendOtpProcessor } from './send-otp.processor';

describe('SendOtpProcessor', () => {
  let processor: SendOtpProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SendOtpProcessor, { provide: MailService, useValue: mailService }],
    }).compile();

    processor = module.get<SendOtpProcessor>(SendOtpProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends an OTP email for a matching job', async () => {
    const job = {
      name: SEND_OTP_JOB,
      data: { to: 'researcher@example.com', code: '123456', expiresInMinutes: 10 },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('researcher@example.com');
    expect(subject).toContain('verification code');
    expect(body).toContain('123456');
    expect(body).toContain('10 minutes');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
