import { Job } from 'bullmq';

import { Test, TestingModule } from '@nestjs/testing';

import {
  SEND_APPLICATION_STATUS_JOB,
  SEND_APPOINTMENT_CONFIRMATION_JOB,
  SEND_ENROLLMENT_OUTCOME_JOB,
  SEND_MEDICATION_REMINDER_EMAIL_JOB,
  SEND_OTP_JOB,
  SEND_PATIENT_CREDENTIALS_JOB,
  SEND_PATIENT_ONBOARDING_WELCOME_JOB,
  SEND_RESET_PASSWORD_JOB,
} from 'src/queues/queues.constants';

import { MailQueueProcessor } from './mail-queue.processor';
import { SendApplicationStatusProcessor } from './send-application-status.processor';
import { SendEnrollmentOutcomeProcessor } from './send-enrollment-outcome.processor';
import { SendAppointmentConfirmationProcessor } from './send-appointment-confirmation.processor';
import { SendMedicationReminderEmailProcessor } from './send-medication-reminder-email.processor';
import { SendOtpProcessor } from './send-otp.processor';
import { SendPatientCredentialsProcessor } from './send-patient-credentials.processor';
import { SendPatientOnboardingWelcomeProcessor } from './send-patient-onboarding-welcome.processor';
import { SendResetPasswordProcessor } from './send-reset-password.processor';

describe('MailQueueProcessor', () => {
  let processor: MailQueueProcessor;
  let sendOtpProcessor: { process: jest.Mock };
  let sendPatientCredentialsProcessor: { process: jest.Mock };
  let sendMedicationReminderEmailProcessor: { process: jest.Mock };
  let sendAppointmentConfirmationProcessor: { process: jest.Mock };
  let sendPatientOnboardingWelcomeProcessor: { process: jest.Mock };
  let sendResetPasswordProcessor: { process: jest.Mock };
  let sendApplicationStatusProcessor: { process: jest.Mock };
  let sendEnrollmentOutcomeProcessor: { process: jest.Mock };

  beforeEach(async () => {
    sendOtpProcessor = { process: jest.fn() };
    sendPatientCredentialsProcessor = { process: jest.fn() };
    sendMedicationReminderEmailProcessor = { process: jest.fn() };
    sendAppointmentConfirmationProcessor = { process: jest.fn() };
    sendPatientOnboardingWelcomeProcessor = { process: jest.fn() };
    sendResetPasswordProcessor = { process: jest.fn() };
    sendApplicationStatusProcessor = { process: jest.fn() };
    sendEnrollmentOutcomeProcessor = { process: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailQueueProcessor,
        { provide: SendOtpProcessor, useValue: sendOtpProcessor },
        { provide: SendPatientCredentialsProcessor, useValue: sendPatientCredentialsProcessor },
        { provide: SendMedicationReminderEmailProcessor, useValue: sendMedicationReminderEmailProcessor },
        { provide: SendAppointmentConfirmationProcessor, useValue: sendAppointmentConfirmationProcessor },
        { provide: SendPatientOnboardingWelcomeProcessor, useValue: sendPatientOnboardingWelcomeProcessor },
        { provide: SendResetPasswordProcessor, useValue: sendResetPasswordProcessor },
        { provide: SendApplicationStatusProcessor, useValue: sendApplicationStatusProcessor },
        { provide: SendEnrollmentOutcomeProcessor, useValue: sendEnrollmentOutcomeProcessor },
      ],
    }).compile();

    processor = module.get<MailQueueProcessor>(MailQueueProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('routes send_appointment_confirmation jobs to SendAppointmentConfirmationProcessor', async () => {
    const job = { name: SEND_APPOINTMENT_CONFIRMATION_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendAppointmentConfirmationProcessor.process).toHaveBeenCalledWith(job);
    expect(sendOtpProcessor.process).not.toHaveBeenCalled();
  });

  it('routes send_otp jobs to SendOtpProcessor', async () => {
    const job = { name: SEND_OTP_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendOtpProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_patient_credentials jobs to SendPatientCredentialsProcessor', async () => {
    const job = { name: SEND_PATIENT_CREDENTIALS_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendPatientCredentialsProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_medication_reminder_email jobs to SendMedicationReminderEmailProcessor', async () => {
    const job = { name: SEND_MEDICATION_REMINDER_EMAIL_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendMedicationReminderEmailProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_patient_onboarding_welcome jobs to SendPatientOnboardingWelcomeProcessor', async () => {
    const job = { name: SEND_PATIENT_ONBOARDING_WELCOME_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendPatientOnboardingWelcomeProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_reset_password jobs to SendResetPasswordProcessor', async () => {
    const job = { name: SEND_RESET_PASSWORD_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendResetPasswordProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_application_status jobs to SendApplicationStatusProcessor', async () => {
    const job = { name: SEND_APPLICATION_STATUS_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendApplicationStatusProcessor.process).toHaveBeenCalledWith(job);
  });

  it('routes send_enrollment_outcome jobs to SendEnrollmentOutcomeProcessor', async () => {
    const job = { name: SEND_ENROLLMENT_OUTCOME_JOB, data: {} } as Job;
    await processor.process(job);
    expect(sendEnrollmentOutcomeProcessor.process).toHaveBeenCalledWith(job);
  });

  it('does nothing for an unrecognized job name', async () => {
    const job = { name: 'some_other_job', data: {} } as Job;
    await processor.process(job);
    expect(sendOtpProcessor.process).not.toHaveBeenCalled();
    expect(sendPatientCredentialsProcessor.process).not.toHaveBeenCalled();
    expect(sendMedicationReminderEmailProcessor.process).not.toHaveBeenCalled();
    expect(sendAppointmentConfirmationProcessor.process).not.toHaveBeenCalled();
    expect(sendPatientOnboardingWelcomeProcessor.process).not.toHaveBeenCalled();
    expect(sendResetPasswordProcessor.process).not.toHaveBeenCalled();
    expect(sendApplicationStatusProcessor.process).not.toHaveBeenCalled();
    expect(sendEnrollmentOutcomeProcessor.process).not.toHaveBeenCalled();
  });
});
