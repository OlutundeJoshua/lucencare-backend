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
export const PROGRAM_APPROVED_JOB = 'program_approved';
export const STUDY_APPROVED_JOB = 'study_approved';
export const SEND_OTP_JOB = 'send_otp';

export const NOTIFICATION_FAN_OUT_BATCH_SIZE = 200;
