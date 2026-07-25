import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';

import { SEND_PATIENT_ONBOARDING_WELCOME_JOB } from 'src/queues/queues.constants';
import { MailService } from 'src/modules/mail/mail.service';
import { SendPatientOnboardingWelcomeJob } from 'src/queues/interfaces/send-patient-onboarding-welcome-job.interface';

@Injectable()
export class SendPatientOnboardingWelcomeProcessor {
  constructor(private readonly mailService: MailService) {}

  async process(job: Job<SendPatientOnboardingWelcomeJob>): Promise<void> {
    if (job.name !== SEND_PATIENT_ONBOARDING_WELCOME_JOB) return;

    const { to, patientName } = job.data;

    await this.mailService.send(
      to,
      'Welcome to LucenCare',
      `Hi ${patientName},\n\nThank you for completing your LucenCare profile. Your account is now fully set up.\n\nYou can now:\n- Book appointments\n- Track your medications\n- Manage your care from your dashboard\n\nWe are glad to have you with us.\n\nThe LucenCare Team`,
    );
  }
}
