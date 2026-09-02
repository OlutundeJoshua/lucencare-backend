import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import { SEND_OTP_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { renderEmailText } from 'src/modules/mail/email-text.util';

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

  it('sends an OTP email for a matching job', async () => {
    const job = {
      name: SEND_OTP_JOB,
      data: { to: 'researcher@example.com', code: '123456', expiresInMinutes: 10 },
    } as Job;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sent();
    expect(to).toBe('researcher@example.com');
    expect(subject).toContain('verification code');
    expect(body).toContain('123456');
    expect(body).toContain('10 minutes');
  });

  describe('email structure', () => {
    const contentOf = (): EmailContent => mailService.send.mock.calls[0][2];

    async function send() {
      await processor.process({
        name: SEND_OTP_JOB,
        data: { to: 'researcher@example.com', code: '123456', expiresInMinutes: 10 },
      } as Job);
    }

    it('puts the code in a code block rather than inline in a sentence', async () => {
      await send();

      expect(contentOf().blocks).toContainEqual({
        kind: 'code',
        value: '123456',
        caption: 'Your one-time verification code is:',
      });
    });

    // The preheader shows on lock screens and in notification banners, where a
    // one-time code should not appear.
    it('keeps the code out of the preheader', async () => {
      await send();

      expect(contentOf().preheader).toBe('Your one-time verification code, valid for 10 minutes.');
      expect(contentOf().preheader).not.toContain('123456');
    });
  });

  it('does nothing for a non-matching job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });
});
