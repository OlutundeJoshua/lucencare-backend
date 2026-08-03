// TODO: Implement — see docs/modules/queues.md

export const NOTIFICATIONS_QUEUE = 'notifications';
export const ADMIN_QUEUE = 'admin';
export const MAIL_QUEUE = 'mail';

export const FAN_OUT_NOTIFY_JOB = 'fan_out_notify';
export const BATCH_NOTIFY_JOB = 'batch_notify';
export const CONSENT_REVOKED_JOB = 'consent_revoked';
export const PROGRAM_REVIEW_JOB = 'program_review';
export const STUDY_REVIEW_JOB = 'study_review';
export const ORG_VERIFICATION_JOB = 'org_verification';
export const ORG_VERIFIED_JOB = 'org_verified';
export const ORG_REJECTED_JOB = 'org_rejected';
export const PROGRAM_APPROVED_JOB = 'program_approved';
export const PROGRAM_REJECTED_JOB = 'program_rejected';
export const STUDY_APPROVED_JOB = 'study_approved';
export const STUDY_REJECTED_JOB = 'study_rejected';
export const SEND_OTP_JOB = 'send_otp';
export const SEND_RESET_PASSWORD_JOB = 'send_reset_password';
export const SEND_PATIENT_CREDENTIALS_JOB = 'send_patient_credentials';
export const MEDICATION_REMINDER_TICK_JOB = 'medication_reminder_tick';
export const MEDICATION_REFILL_CHECK_JOB = 'medication_refill_check';
export const SEND_MEDICATION_REMINDER_EMAIL_JOB = 'send_medication_reminder_email';
export const SEND_APPOINTMENT_CONFIRMATION_JOB = 'send_appointment_confirmation';
export const SEND_PATIENT_ONBOARDING_WELCOME_JOB = 'send_patient_onboarding_welcome';

export const NOTIFICATION_FAN_OUT_BATCH_SIZE = 200;
export const MEDICATION_REFILL_CHECK_CRON = '0 7 * * *';

// Queue producer defaults: drop completed/failed job records instead of letting
// them accumulate in Redis forever (bounded by removeOnFail so recent failures
// stay inspectable).
export const QUEUE_DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 1000,
};

// Worker polling defaults, raised from BullMQ's defaults (stalledInterval 30_000ms,
// drainDelay 5s) to cut idle Redis command volume on a command-metered plan.
// Stalled-job recovery stays enabled — just checked less often.
export const WORKER_POLL_OPTIONS = {
  stalledInterval: 90_000,
  drainDelay: 20,
};
