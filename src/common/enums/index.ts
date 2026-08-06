export enum UserRole {
  PATIENT = 'patient',
  NGO_ADMIN = 'ngo_admin',
  HMO_COORDINATOR = 'hmo_coordinator',
  RESEARCHER = 'researcher',
  PLATFORM_ADMIN = 'platform_admin',
  PROFESSIONAL = 'professional',
  BENEFACTOR = 'benefactor',
}

export enum ApplicationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum ProfessionType {
  DOCTOR = 'Doctor',
  NURSE = 'Nurse',
  THERAPIST = 'Therapist',
  OTHER = 'Other',
}

export enum OrgType {
  NGO = 'ngo',
  HMO = 'hmo',
}

export enum OrgStatus {
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
}

export enum ConsentPurpose {
  NGO_FUNDING = 'ngo_funding',
  CLINICAL_RESEARCH_RECRUITMENT = 'clinical_research_recruitment',
  HMO_CARE = 'hmo_care',
}

export enum ConsentStatus {
  NOT_GRANTED = 'not_granted',
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  REVOKED = 'revoked',
}

export enum ProgramType {
  NGO_FUNDING = 'ngo_funding',
  RESEARCH_STUDY = 'research_study',
}

export enum ProgramStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum StudyStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

export enum EnrollmentStatus {
  ACTIVE = 'active',
  REVOKED_BY_PATIENT = 'revoked_by_patient',
  EXPIRED = 'expired',
}

export enum StudyEnrollmentStatus {
  INTERESTED = 'interested',
  SCREENED = 'screened',
  ENROLLED = 'enrolled',
  WITHDRAWN = 'withdrawn',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum CareEventType {
  CLINIC_VISIT = 'clinic_visit',
  LAB_RESULT = 'lab_result',
  PRESCRIPTION = 'prescription',
  REFERRAL = 'referral',
}

export enum HmoLinkRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum NotificationType {
  PROGRAM_MATCH = 'program_match',
  ENROLLMENT_UPDATE = 'enrollment_update',
  CONSENT_REVOKED = 'consent_revoked',
  NEW_MESSAGE = 'new_message',
  STUDY_MATCH = 'study_match',
  ORG_VERIFIED = 'org_verified',
  ORG_PENDING_VERIFICATION = 'org_pending_verification',
  HMO_LINK_REQUEST = 'hmo_link_request',
  MEDICATION_REMINDER = 'medication_reminder',
  REFILL_ALERT = 'refill_alert',
}

export enum AuditAction {
  EXPORT = 'export',
  REVOKE_CONSENT = 'revoke_consent',
  ADMIN_APPROVE = 'admin_approve',
  ADMIN_REJECT = 'admin_reject',
  APPLICATION_SUBMITTED = 'application_submitted',
  LOGIN = 'login',
  CONSENT_CHANGE = 'consent_change',
  CROSS_ORG_ATTEMPT = 'cross_org_attempt',
  MEDICATION_REFILL_REQUESTED = 'medication_refill_requested',
}

export enum DoseStatus {
  TAKEN = 'taken',
  PENDING = 'pending',
  LATER = 'later',
  SKIPPED = 'skipped',
  // Computed display state only — MedicationsService overlays this onto a
  // PENDING dose that falls within the due-now window. Never persisted:
  // LogDoseDto restricts patient-submitted statuses to exclude it.
  DUE_NOW = 'due_now',
}

// Subset of DoseStatus a patient may actually submit via POST /medications/:id/doses/log —
// excludes DUE_NOW, which is a read-only overlay computed by MedicationsService and must
// never be written to the DB. A real enum can't subset another without duplicating string
// literals as a nominally distinct type, so this stays a union of the real DoseStatus members.
export const LOGGABLE_DOSE_STATUSES = [
  DoseStatus.TAKEN,
  DoseStatus.PENDING,
  DoseStatus.LATER,
  DoseStatus.SKIPPED,
] as const;
export type LoggableDoseStatus = (typeof LOGGABLE_DOSE_STATUSES)[number];

export enum TokenPurpose {
  PDF_EXPORT = 'pdf_export',
  OTP_VERIFY = 'otp_verify',
}

export enum AppointmentType {
  CONSULTATION = 'consultation',
  FOLLOW_UP = 'follow_up',
  LAB_TEST = 'lab_test',
  PHYSIOTHERAPY = 'physiotherapy',
  SPECIALIST_REVIEW = 'specialist_review',
}

export enum AppointmentStatus {
  CONFIRMED = 'confirmed',
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum AppointmentConfirmationAction {
  CREATED = 'created',
  RESCHEDULED = 'rescheduled',
}
