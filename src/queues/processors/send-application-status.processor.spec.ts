import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ApplicantRole, ApplicationEmailEvent } from 'src/common/enums';
import { SEND_APPLICATION_STATUS_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';

import { SendApplicationStatusProcessor } from './send-application-status.processor';

const FRONTEND_URL = 'http://localhost:3001';
const ALL_ROLES = [
  ApplicantRole.NGO,
  ApplicantRole.HMO,
  ApplicantRole.PROFESSIONAL,
  ApplicantRole.BENEFACTOR,
];

describe('SendApplicationStatusProcessor', () => {
  let processor: SendApplicationStatusProcessor;
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    mailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendApplicationStatusProcessor,
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(FRONTEND_URL) } },
      ],
    }).compile();

    processor = module.get<SendApplicationStatusProcessor>(SendApplicationStatusProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Runs the processor and returns the [to, subject, body] it sent. */
  async function run(
    role: ApplicantRole,
    event: ApplicationEmailEvent,
    extra: { reason?: string; applicantName?: string } = {},
  ): Promise<[string, string, string]> {
    const job = {
      name: SEND_APPLICATION_STATUS_JOB,
      data: {
        to: 'applicant@example.com',
        applicantName: extra.applicantName ?? 'Hope Health Initiative',
        role,
        event,
        reason: extra.reason,
      },
    } as Job;

    await processor.process(job);

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

  // Every one of the 12 role x event combinations must produce a usable email.
  describe('all role and event combinations', () => {
    for (const role of ALL_ROLES) {
      for (const event of [
        ApplicationEmailEvent.RECEIVED,
        ApplicationEmailEvent.APPROVED,
        ApplicationEmailEvent.REJECTED,
      ]) {
        it(`${role} / ${event} addresses the applicant and signs off`, async () => {
          const [to, subject, body] = await run(role, event, { reason: 'Licence unverifiable' });

          expect(to).toBe('applicant@example.com');
          expect(subject.length).toBeGreaterThan(0);
          expect(body).toContain('Hope Health Initiative');
          expect(body).toContain('The LucenCare Team');
          // The composed copy must never leak a placeholder.
          expect(body).not.toContain('undefined');
          expect(subject).not.toContain('undefined');
        });
      }
    }

    it('gives each role its own label', async () => {
      // Sequential, not Promise.all: run() reads mock.calls[0], so concurrent
      // invocations would all inspect the same call.
      const labels: string[] = [];
      for (const role of ALL_ROLES) {
        mailService.send.mockClear();
        const [, subject] = await run(role, ApplicationEmailEvent.RECEIVED);
        labels.push(subject);
      }

      expect(new Set(labels).size).toBe(ALL_ROLES.length);
      expect(labels[0]).toContain('NGO');
      expect(labels[1]).toContain('HMO');
      expect(labels[2]).toContain('healthcare professional');
      expect(labels[3]).toContain('benefactor');
    });
  });

  describe('received', () => {
    it('states the 48-hour review window the onboarding wizard promises', async () => {
      const [, subject, body] = await run(ApplicantRole.NGO, ApplicationEmailEvent.RECEIVED);

      expect(subject).toContain("We've received your NGO application");
      expect(body).toContain('48 hours');
      expect(body).toContain('nothing else you need to do');
    });
  });

  describe('approved', () => {
    it('carries a sign-in link and the role capabilities', async () => {
      const [, subject, body] = await run(ApplicantRole.HMO, ApplicationEmailEvent.APPROVED);

      expect(subject).toContain('has been approved');
      expect(body).toContain(`${FRONTEND_URL}/login`);
      expect(body).toContain('now active');
      // Bulleted capabilities, in the house style.
      expect(body).toContain('\n- ');
      expect(body).toContain('enrolled members');
    });

    it('gives professionals professional capabilities, not org ones', async () => {
      const [, , body] = await run(ApplicantRole.PROFESSIONAL, ApplicationEmailEvent.APPROVED);

      expect(body).toContain('Coordinate care');
      expect(body).not.toContain('funding programmes');
    });
  });

  describe('rejected', () => {
    it('includes the reason and what to do next', async () => {
      const [, subject, body] = await run(ApplicantRole.BENEFACTOR, ApplicationEmailEvent.REJECTED, {
        reason: 'Identity document was not legible',
      });

      expect(subject).toContain('was not approved');
      expect(body).toContain('Reason: Identity document was not legible');
      // Same wording as the in-app rejected screen.
      expect(body).toContain('contact support');
      expect(body).toContain('apply again');
    });

    // The reason is required on reject by both DTOs, but a missing one must not
    // print "Reason: undefined" at the user.
    it('omits the reason line entirely when none was given', async () => {
      const [, , body] = await run(ApplicantRole.NGO, ApplicationEmailEvent.REJECTED, {
        reason: undefined,
      });

      expect(body).not.toContain('Reason:');
      expect(body).not.toContain('undefined');
      // Still tells them what to do.
      expect(body).toContain('contact support');
    });

    it('does not offer a login link to a rejected applicant', async () => {
      const [, , body] = await run(ApplicantRole.NGO, ApplicationEmailEvent.REJECTED, {
        reason: 'Registration number could not be verified',
      });

      expect(body).not.toContain(`${FRONTEND_URL}/login`);
    });
  });
});
