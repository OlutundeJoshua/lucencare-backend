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
  // The NGO is still preparing it. Invisible to patients AND to the admin queue —
  // creating a programme no longer submits it; POST /programs/:id/submit does.
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

/**
 * The states an NGO may hand to the platform for review. Rejected is included on
 * purpose: fixing what the reviewer objected to and resubmitting is the point of
 * recording a reason, and without this edge a rejection is terminal.
 */
export const SUBMITTABLE_PROGRAM_STATUSES = [
  ProgramStatus.DRAFT,
  ProgramStatus.REJECTED,
] as const;

/**
 * The states an NGO may still edit freely. Once approved a programme is public and
 * patients have applied under its stated terms, so only pause/resume and extending
 * the closing date remain — see ProgramsService.update().
 */
export const EDITABLE_PROGRAM_STATUSES = [
  ProgramStatus.DRAFT,
  ProgramStatus.PENDING_REVIEW,
  ProgramStatus.REJECTED,
] as const;

export enum StudyStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

export enum EnrollmentStatus {
  /** Applied and awaiting the NGO's decision. */
  ACTIVE = 'active',
  /** The NGO accepted the patient onto the programme; occupies a slot. */
  SELECTED = 'selected',
  /** Held in reserve — still a live application, but not occupying a slot. */
  WAITLISTED = 'waitlisted',
  /** The NGO declined; enrollments.rejection_reason carries why. */
  REJECTED = 'rejected',
  REVOKED_BY_PATIENT = 'revoked_by_patient',
  EXPIRED = 'expired',
}

/**
 * Statuses an NGO reviewer may set. Excludes `active` (the applicant sets that by
 * applying), `revoked_by_patient` (the patient's alone) and `expired` (the system's).
 */
export const REVIEWABLE_ENROLLMENT_STATUSES = [
  EnrollmentStatus.SELECTED,
  EnrollmentStatus.WAITLISTED,
  EnrollmentStatus.REJECTED,
] as const;
export type ReviewableEnrollmentStatus = (typeof REVIEWABLE_ENROLLMENT_STATUSES)[number];

/**
 * A live application — one the patient is still in the running for. Used to stop a
 * patient holding two open applications to the same programme, while still letting
 * someone rejected or withdrawn apply again later.
 */
export const LIVE_ENROLLMENT_STATUSES = [
  EnrollmentStatus.ACTIVE,
  EnrollmentStatus.SELECTED,
  EnrollmentStatus.WAITLISTED,
] as const;

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
  // A patient applied to an NGO's programme — sent to that NGO's staff. Distinct
  // from PROGRAM_MATCH, which travels the other way (a programme suggested to a
  // patient) and would otherwise render the wrong copy in the NGO's feed.
  ENROLLMENT_APPLICATION = 'enrollment_application',
  // The NGO's decision on that application — sent to the patient.
  ENROLLMENT_UPDATE = 'enrollment_update',
  CONSENT_REVOKED = 'consent_revoked',
  NEW_MESSAGE = 'new_message',
  STUDY_MATCH = 'study_match',
  ORG_VERIFIED = 'org_verified',
  ORG_PENDING_VERIFICATION = 'org_pending_verification',
  HMO_LINK_REQUEST = 'hmo_link_request',
  MEDICATION_REMINDER = 'medication_reminder',
  REFILL_ALERT = 'refill_alert',
  // A professional or benefactor application is awaiting review. The org-shaped
  // equivalent is ORG_PENDING_VERIFICATION.
  APPLICATION_PENDING_REVIEW = 'application_pending_review',
  // An NGO submitted a funding programme — sent to the platform admins.
  PROGRAM_PENDING_REVIEW = 'program_pending_review',
  // The platform's decision on that programme — sent back to the NGO's staff.
  PROGRAM_REVIEWED = 'program_reviewed',
}

export enum AuditAction {
  EXPORT = 'export',
  REVOKE_CONSENT = 'revoke_consent',
  ADMIN_APPROVE = 'admin_approve',
  ADMIN_REJECT = 'admin_reject',
  APPLICATION_SUBMITTED = 'application_submitted',
  // An NGO edited its own programme. Until now edits left no trace at all, so an
  // approved programme could be re-scoped with nothing to show for it.
  PROGRAM_UPDATED = 'program_updated',
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

/**
 * The four roles whose accounts are gated behind admin approval, as the applicant
 * sees themselves. Deliberately not UserRole: this keys the application-email copy
 * table, and a Record<UserRole, ...> would force meaningless entries for patient,
 * researcher and platform_admin.
 */
export enum ApplicantRole {
  NGO = 'ngo',
  HMO = 'hmo',
  PROFESSIONAL = 'professional',
  BENEFACTOR = 'benefactor',
}

/** The three points in an application's life at which we email the applicant. */
export enum ApplicationEmailEvent {
  RECEIVED = 'received',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
