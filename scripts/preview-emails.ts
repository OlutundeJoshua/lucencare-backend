/**
 * Renders every transactional email to an HTML file you can open in a browser, plus a
 * contact-sheet index. Nothing is sent and no SMTP connection is opened.
 *
 * The previews are produced by running the REAL processors against a capturing
 * MailService, so what you see here is what production renders — a preview built from a
 * separate copy of the templates would drift the first time someone edited one.
 *
 * Usage: pnpm run preview:emails [out-dir]
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';

import {
  ApplicantRole,
  ApplicationEmailEvent,
  AppointmentConfirmationAction,
  AppointmentReminderLead,
  EnrollmentStatus,
} from 'src/common/enums';
import {
  SEND_APPLICATION_STATUS_JOB,
  SEND_APPOINTMENT_CONFIRMATION_JOB,
  SEND_APPOINTMENT_REMINDER_JOB,
  SEND_ENROLLMENT_OUTCOME_JOB,
  SEND_MEDICATION_REMINDER_EMAIL_JOB,
  SEND_OTP_JOB,
  SEND_PATIENT_CREDENTIALS_JOB,
  SEND_PATIENT_ONBOARDING_WELCOME_JOB,
  SEND_PROGRAM_STATUS_JOB,
  SEND_RESET_PASSWORD_JOB,
} from 'src/queues/queues.constants';
import { EmailContent } from 'src/common/interfaces/email-content.interface';
import { EmailRendererService } from 'src/modules/mail/email-renderer.service';
import { MailService } from 'src/modules/mail/mail.service';

import { SendApplicationStatusProcessor } from 'src/queues/processors/send-application-status.processor';
import { SendAppointmentConfirmationProcessor } from 'src/queues/processors/send-appointment-confirmation.processor';
import { SendAppointmentReminderProcessor } from 'src/queues/processors/send-appointment-reminder.processor';
import { SendEnrollmentOutcomeProcessor } from 'src/queues/processors/send-enrollment-outcome.processor';
import { SendMedicationReminderEmailProcessor } from 'src/queues/processors/send-medication-reminder-email.processor';
import { SendOtpProcessor } from 'src/queues/processors/send-otp.processor';
import { SendPatientCredentialsProcessor } from 'src/queues/processors/send-patient-credentials.processor';
import { SendPatientOnboardingWelcomeProcessor } from 'src/queues/processors/send-patient-onboarding-welcome.processor';
import { SendProgramStatusProcessor } from 'src/queues/processors/send-program-status.processor';
import { SendResetPasswordProcessor } from 'src/queues/processors/send-reset-password.processor';

const FRONTEND_URL = 'https://www.lucencare.com';

/**
 * The logo is copied next to the previews and referenced relatively, so the header
 * renders even before the frontend has deployed `public/logo-email.png` — an absolute
 * URL would show a broken image until then, which is easy to mistake for a bug in the
 * template. Production reads the real URL from `mail.logoUrl`.
 */
const LOGO_FILENAME = 'logo-email.png';
const FRONTEND_REPO =
  process.env.LUCENCARE_FRONTEND ?? join(homedir(), 'Documents/Personal/Lucen-Care-App');

const CONFIG = {
  'app.frontendUrl': FRONTEND_URL,
  'mail.logoUrl': LOGO_FILENAME,
  'mail.brandUrl': FRONTEND_URL,
  'mail.supportEmail': 'lucencare@gmail.com',
} as const;

const configService = {
  get: (key: string) => CONFIG[key as keyof typeof CONFIG],
} as unknown as ConfigService;

const renderer = new EmailRendererService(configService);

interface Captured {
  slug: string;
  to: string;
  subject: string;
  content: EmailContent;
}

const captured: Captured[] = [];
let currentSlug = '';

/** Stands in for MailService: records what would have been sent instead of sending it. */
const mail = {
  send: async (to: string, subject: string, content: EmailContent) => {
    captured.push({ slug: currentSlug, to, subject, content });
  },
} as unknown as MailService;

/** Runs one processor and files whatever it tried to send under `slug`. */
async function capture(slug: string, run: () => Promise<void>): Promise<void> {
  currentSlug = slug;
  await run();
}

const job = <T>(name: string, data: T) => ({ name, data }) as Job<T>;

async function collect(): Promise<void> {
  await capture('otp', () =>
    new SendOtpProcessor(mail).process(
      job(SEND_OTP_JOB, { to: 'ada@example.com', code: '482913', expiresInMinutes: 5 }),
    ),
  );

  await capture('reset-password', () =>
    new SendResetPasswordProcessor(mail, configService).process(
      job(SEND_RESET_PASSWORD_JOB, {
        to: 'ada@example.com',
        token: 'eyJhbGciOiJSUzI1NiJ9.preview-token',
        expiresInMinutes: 15,
      }),
    ),
  );

  await capture('patient-credentials', () =>
    new SendPatientCredentialsProcessor(mail, configService).process(
      job(SEND_PATIENT_CREDENTIALS_JOB, { to: 'ada@example.com', tempPassword: 'Kf7-2Qtx-9Lm' }),
    ),
  );

  await capture('patient-welcome', () =>
    new SendPatientOnboardingWelcomeProcessor(mail, configService).process(
      job(SEND_PATIENT_ONBOARDING_WELCOME_JOB, {
        to: 'ada@example.com',
        patientName: 'Ada Okonkwo',
      }),
    ),
  );

  for (const event of Object.values(ApplicationEmailEvent)) {
    await capture(`application-${event}`, () =>
      new SendApplicationStatusProcessor(mail, configService).process(
        job(SEND_APPLICATION_STATUS_JOB, {
          to: 'ngo@example.com',
          applicantName: 'Hope Foundation',
          role: ApplicantRole.NGO,
          event,
          reason:
            event === ApplicationEmailEvent.REJECTED
              ? 'The CAC registration number could not be verified.'
              : undefined,
        }),
      ),
    );
  }

  for (const approved of [true, false]) {
    await capture(`program-${approved ? 'approved' : 'rejected'}`, () =>
      new SendProgramStatusProcessor(mail, configService).process(
        job(SEND_PROGRAM_STATUS_JOB, {
          to: 'ngo@example.com',
          recipientName: 'Hope Foundation',
          programTitle: 'Lagos Insulin Access Programme',
          approved,
          reason: approved ? undefined : 'The eligibility criteria need a location filter.',
        }),
      ),
    );
  }

  for (const status of [
    EnrollmentStatus.SELECTED,
    EnrollmentStatus.WAITLISTED,
    EnrollmentStatus.REJECTED,
  ] as const) {
    await capture(`enrollment-${status}`, () =>
      new SendEnrollmentOutcomeProcessor(mail, configService).process(
        job(SEND_ENROLLMENT_OUTCOME_JOB, {
          to: 'ada@example.com',
          patientName: 'Ada',
          programTitle: 'Lagos Insulin Access Programme',
          status,
          reason:
            status === EnrollmentStatus.REJECTED
              ? 'This round prioritised applicants in Kano State.'
              : undefined,
        }),
      ),
    );
  }

  for (const action of Object.values(AppointmentConfirmationAction)) {
    await capture(`appointment-${action}`, () =>
      new SendAppointmentConfirmationProcessor(mail).process(
        job(SEND_APPOINTMENT_CONFIRMATION_JOB, {
          to: 'ada@example.com',
          patientName: 'Ada',
          appointmentDate: 'Tuesday, 15 September',
          time: '10:30',
          provider: 'Dr Bello',
          specialty: 'Endocrinology',
          facility: 'Lagoon Hospital, Ikoyi',
          action,
        }),
      ),
    );
  }

  for (const lead of Object.values(AppointmentReminderLead)) {
    await capture(`reminder-appointment-${lead}`, () =>
      new SendAppointmentReminderProcessor(mail).process(
        job(SEND_APPOINTMENT_REMINDER_JOB, {
          targets: [
            {
              email: 'ada@example.com',
              firstName: 'Ada',
              lead,
              appointmentType: 'Endocrinology follow-up',
              appointmentDate: 'Tuesday, 15 September',
              time: '10:30',
              facility: 'Lagoon Hospital, Ikoyi',
              provider: 'Dr Bello',
            },
          ],
        }),
      ),
    );
  }

  for (const streakDays of [12, 0]) {
    await capture(`reminder-medication-${streakDays > 0 ? 'streak' : 'no-streak'}`, () =>
      new SendMedicationReminderEmailProcessor(mail, configService).process(
        job(SEND_MEDICATION_REMINDER_EMAIL_JOB, {
          targets: [
            {
              email: 'ada@example.com',
              firstName: 'Ada',
              medicationName: 'Metformin',
              dosage: '500mg, one tablet',
              scheduledTime: '08:00',
              streakDays,
            },
          ],
        }),
      ),
    );
  }
}

function indexHtml(items: Captured[], outDir: string): string {
  const rows = items
    .map(
      (item) =>
        `<li><a href="./${item.slug}.html">${item.slug}</a>` +
        `<span class="subject">${item.subject}</span></li>`,
    )
    .join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<title>LucenCare email previews</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; background:#F4F5F8; color:#12122A;
         margin:0; padding:40px 24px; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { color:#3535A8; font-size:22px; margin:0 0 4px; }
  p.hint { color:#7A9E9A; font-size:13px; margin:0 0 24px; }
  ul { list-style:none; margin:0; padding:0; background:#fff; border-radius:12px;
       border:1px solid #D8EFEC; overflow:hidden; }
  li { display:flex; gap:16px; align-items:baseline; padding:12px 18px; border-top:1px solid #E6E9F0; }
  li:first-child { border-top:0; }
  a { color:#3535A8; font-weight:600; text-decoration:none; min-width:230px; }
  a:hover { text-decoration:underline; }
  .subject { color:#7A9E9A; font-size:13px; }
</style>
<div class="wrap">
  <h1>LucenCare email previews</h1>
  <p class="hint">${items.length} rendered from ${outDir}. Each file is the exact HTML part
  MailService would send; the plain-text part sits beside it as <code>.txt</code>.</p>
  <ul>
${rows}
  </ul>
</div>`;
}

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? 'tmp/email-previews');
  mkdirSync(outDir, { recursive: true });

  await collect();

  const logoSource = join(FRONTEND_REPO, 'public', LOGO_FILENAME);
  if (existsSync(logoSource)) {
    copyFileSync(logoSource, join(outDir, LOGO_FILENAME));
  } else {
    console.warn(`Logo not found at ${logoSource} — previews will show a broken image.`);
    console.warn(
      'Set LUCENCARE_FRONTEND to the frontend repo path, or run scripts/render-email-logo.sh.',
    );
  }

  for (const item of captured) {
    writeFileSync(join(outDir, `${item.slug}.html`), renderer.toHtml(item.subject, item.content));
    writeFileSync(
      join(outDir, `${item.slug}.txt`),
      `Subject: ${item.subject}\nTo: ${item.to}\n\n${renderer.toText(item.content)}\n`,
    );
  }

  writeFileSync(join(outDir, 'index.html'), indexHtml(captured, outDir));

  console.log(`Rendered ${captured.length} email previews to ${outDir}`);
  console.log(`Open ${join(outDir, 'index.html')}`);
}

void main();
