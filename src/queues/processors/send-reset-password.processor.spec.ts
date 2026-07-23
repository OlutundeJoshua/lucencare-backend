import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { SEND_RESET_PASSWORD_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendResetPasswordProcessor } from './send-reset-password.processor';

describe('SendResetPasswordProcessor', () => {
  let processor: SendResetPasswordProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendResetPasswordProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3001') } },
      ],
    }).compile();

    processor = module.get<SendResetPasswordProcessor>(SendResetPasswordProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('sends a reset-password email with a link built from the frontend URL', async () => {
    const job = {
      name: SEND_RESET_PASSWORD_JOB,
      data: { to: 'user@example.com', token: 'abc123', expiresInMinutes: 60 },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = mailService.send.mock.calls[0];
    expect(to).toBe('user@example.com');
    expect(subject).toContain('Reset your');
    expect(body).toContain('http://localhost:3001/reset-password?token=abc123');
    expect(body).toContain('60 minutes');
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
