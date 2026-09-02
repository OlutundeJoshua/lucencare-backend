import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SEND_PATIENT_ONBOARDING_WELCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { firstName } from 'src/common/utils/first-name.util';
import { SendPatientOnboardingWelcomeJob } from 'src/queues/interfaces/send-patient-onboarding-welcome-job.interface';

@Injectable()
export class SendPatientOnboardingWelcomeProcessor {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async process(job: Job<SendPatientOnboardingWelcomeJob>): Promise<void> {
    if (job.name !== SEND_PATIENT_ONBOARDING_WELCOME_JOB) return;

    const { to, patientName } = job.data;
    const name = firstName(patientName);
    const dashboardUrl = `${this.configService.get<string>('app.frontendUrl')}/patient/dashboard`;

    await this.mailService.send(to, `Welcome to LucenCare 💚, ${name}`, {
      preheader: "Here's what you can do right away.",
      blocks: [
        { kind: 'paragraph', text: `Hello ${name},` },
        { kind: 'paragraph', text: "Welcome to LucenCare. We're really glad you're here." },
        {
          kind: 'paragraph',
          text: "Whether you're managing a chronic condition yourself, or supporting someone you love through one, LucenCare is built to make the journey lighter. Here's what you can do right away:",
        },
        {
          kind: 'list',
          items: [
            'Set up your medication reminders so nothing gets missed',
            'Book and track appointments in one place',
            'Join a community group for your condition to connect with people who get it',
            'Explore your health dashboard to see everything at a glance',
          ],
        },
        {
          kind: 'button',
          label: 'Go to my dashboard',
          url: dashboardUrl,
          textLabel: 'See your dashboard and manage your health here',
        },
        { kind: 'paragraph', text: 'If you need support, our support team is available 24/7.' },
        {
          kind: 'paragraph',
          text: "Remember, you've got this — and now, you've got LucenCare on this journey.",
        },
        { kind: 'signoff', text: 'The LucenCare Team 💚' },
      ],
    });
  }
}
