import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  MAIL_QUEUE,
  SEND_APPLICATION_STATUS_JOB,
  SEND_APPOINTMENT_CONFIRMATION_JOB,
  SEND_MEDICATION_REMINDER_EMAIL_JOB,
  SEND_OTP_JOB,
  SEND_PATIENT_CREDENTIALS_JOB,
  SEND_PATIENT_ONBOARDING_WELCOME_JOB,
  SEND_RESET_PASSWORD_JOB,
  WORKER_POLL_OPTIONS,
} from 'src/queues/queues.constants';

import { SendApplicationStatusProcessor } from './send-application-status.processor';
import { SendAppointmentConfirmationProcessor } from './send-appointment-confirmation.processor';
import { SendMedicationReminderEmailProcessor } from './send-medication-reminder-email.processor';
import { SendOtpProcessor } from './send-otp.processor';
import { SendPatientCredentialsProcessor } from './send-patient-credentials.processor';
import { SendPatientOnboardingWelcomeProcessor } from './send-patient-onboarding-welcome.processor';
import { SendResetPasswordProcessor } from './send-reset-password.processor';

@Processor(MAIL_QUEUE, WORKER_POLL_OPTIONS)
export class MailQueueProcessor extends WorkerHost {
  constructor(
    private readonly sendOtpProcessor: SendOtpProcessor,
    private readonly sendPatientCredentialsProcessor: SendPatientCredentialsProcessor,
    private readonly sendMedicationReminderEmailProcessor: SendMedicationReminderEmailProcessor,
    private readonly sendAppointmentConfirmationProcessor: SendAppointmentConfirmationProcessor,
    private readonly sendPatientOnboardingWelcomeProcessor: SendPatientOnboardingWelcomeProcessor,
    private readonly sendResetPasswordProcessor: SendResetPasswordProcessor,
    private readonly sendApplicationStatusProcessor: SendApplicationStatusProcessor,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SEND_OTP_JOB:
        return this.sendOtpProcessor.process(job);
      case SEND_PATIENT_CREDENTIALS_JOB:
        return this.sendPatientCredentialsProcessor.process(job);
      case SEND_MEDICATION_REMINDER_EMAIL_JOB:
        return this.sendMedicationReminderEmailProcessor.process(job);
      case SEND_APPOINTMENT_CONFIRMATION_JOB:
        return this.sendAppointmentConfirmationProcessor.process(job);
      case SEND_PATIENT_ONBOARDING_WELCOME_JOB:
        return this.sendPatientOnboardingWelcomeProcessor.process(job);
      case SEND_RESET_PASSWORD_JOB:
        return this.sendResetPasswordProcessor.process(job);
      case SEND_APPLICATION_STATUS_JOB:
        return this.sendApplicationStatusProcessor.process(job);
      default:
        return;
    }
  }
}
