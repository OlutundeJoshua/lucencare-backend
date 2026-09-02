import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { SEND_PROGRAM_STATUS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { renderEmailText } from 'src/modules/mail/email-text.util';

import { SendProgramStatusProcessor } from './send-program-status.processor';

const FRONTEND_URL = 'http://localhost:3001';

describe('SendProgramStatusProcessor', () => {
  let processor: SendProgramStatusProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendProgramStatusProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(FRONTEND_URL) } },
      ],
    }).compile();

    processor = module.get(SendProgramStatusProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  async function run(approved: boolean, reason?: string): Promise<[string, string, string]> {
    await processor.process({
      name: SEND_PROGRAM_STATUS_JOB,
      data: {
        to: 'ngo@example.com',
        recipientName: 'Hope Health Initiative',
        programTitle: 'Chronic Care Fund',
        approved,
        reason,
      },
    } as Job);

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, subject, content] = mailService.send.mock.calls[0];
    // The processor hands MailService a structured EmailContent; the copy
    // assertions below are about its plain-text rendering.
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

  it('tells the NGO their programme is live', async () => {
    const [to, subject, body] = await run(true);

    expect(to).toBe('ngo@example.com');
    expect(subject).toBe('Chronic Care Fund has been approved');
    expect(body).toContain('Hi Hope Health Initiative,');
    expect(body).toContain('Chronic Care Fund has been approved and is now live.');
    expect(body).toContain('Applicants queue');
    expect(body).toContain(`View your programmes: ${FRONTEND_URL}/ngo/programs`);
    expect(body).toContain('The LucenCare Team');
  });

  it('tells the NGO a rejected programme can be resubmitted', async () => {
    const [, subject, body] = await run(false);

    expect(subject).toBe('Chronic Care Fund was not approved');
    expect(body).toContain('was not approved for publication');
    expect(body).toContain('submit it again');
  });

  it('includes the reason on a rejection', async () => {
    const [, , body] = await run(false, 'Eligibility criteria need a location filter');

    expect(body).toContain('Reason: Eligibility criteria need a location filter');
  });

  // A missing reason must never reach the NGO as "Reason: undefined".
  it('omits the reason line entirely when none was given', async () => {
    const [, subject, body] = await run(false, undefined);

    expect(body).not.toContain('Reason:');
    expect(body).not.toContain('undefined');
    expect(subject).not.toContain('undefined');
  });

  describe('email structure', () => {
    it('sets a preheader so the inbox snippet says the outcome', async () => {
      await run(true);

      expect(contentOf().preheader).toBe('Chronic Care Fund has been approved and is now live.');
    });

    it('makes the outcome a callout and the link a button', async () => {
      await run(true);

      const kinds = contentOf().blocks.map((block) => block.kind);
      expect(kinds).toContain('callout');
      expect(kinds).toContain('button');
    });

    // The short label is what the button shows; the longer phrase is what the
    // plain-text part uses to introduce the bare URL.
    it('gives the button a short label and a longer text label', async () => {
      await run(true);

      const button = contentOf().blocks.find((block) => block.kind === 'button');
      expect(button).toEqual({
        kind: 'button',
        label: 'View programmes',
        url: `${FRONTEND_URL}/ngo/programs`,
        textLabel: 'View your programmes',
      });
    });
  });
});
