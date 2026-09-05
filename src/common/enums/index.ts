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
export const SUBMITTABLE_PROGRAM_STATUSES = [ProgramStatus.DRAFT, ProgramStatus.REJECTED] as const;

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

export enum CommunityStatus {
  ACTIVE = 'active',
  /** Hidden from browse. Existing posts stay readable to members; nobody can post. */
  ARCHIVED = 'archived',
}

/**
 * Shared by posts and comments — the two are moderated identically, so a second
 * enum would only be a copy that could drift.
 */
export enum CommunityContentStatus {
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
}

/** One member today. The column exists so "helpful"/"supportive" need no migration. */
export enum CommunityReactionType {
  LIKE = 'like',
}

export enum CommunityReportTarget {
  POST = 'post',
  COMMENT = 'comment',
}

export enum CommunityReportReason {
  SPAM = 'spam',
  HARASSMENT = 'harassment',
  MISINFORMATION = 'misinformation',
  /** A professional gave individualised clinical advice in a public thread. */
  MEDICAL_ADVICE = 'medical_advice',
  /** Someone posted identifying or contact details — theirs or another patient's. */
  PERSONAL_DATA = 'personal_data',
  OTHER = 'other',
}

export enum CommunityReportStatus {
  PENDING = 'pending',
  /** The moderator agreed and hid the content. */
  ACTIONED = 'actioned',
  DISMISSED = 'dismissed',
}

/**
 * What an admin may DO to a report. Kept distinct from CommunityReportStatus so the
 * DTO validates an intent rather than letting a client name a stored state directly.
 */
export enum CommunityModerationAction {
  HIDE = 'hide',
  DISMISS = 'dismiss',
}

/**
 * The three roles with access to the community. ngo_admin, hmo_coordinator and
 * researcher are deliberately absent: the community is a patient-support space, and
 * an organisation reading it would be reading health disclosures no ConsentGrant
 * ever covered.
 */
export const COMMUNITY_PARTICIPANT_ROLES = [
  UserRole.PATIENT,
  UserRole.PROFESSIONAL,
  UserRole.BENEFACTOR,
] as const;
export type CommunityParticipantRole = (typeof COMMUNITY_PARTICIPANT_ROLES)[number];

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
  // Someone commented on, or replied under, a post you wrote.
  COMMUNITY_POST_REPLY = 'community_post_reply',
  COMMUNITY_COMMENT_REPLY = 'community_comment_reply',
  // Your post or comment crossed a helpful-marks milestone. Never fired per-like:
  // like volume is unbounded, and one row per like would bury the whole feed.
  COMMUNITY_REACTION_MILESTONE = 'community_reaction_milestone',
  // A platform admin hid your post or comment. The author is always told, and why —
  // silent removal generates support load and teaches nobody anything.
  COMMUNITY_CONTENT_HIDDEN = 'community_content_hidden',
  // The report you filed has been reviewed — sent to the reporter, not the author.
  COMMUNITY_REPORT_RESOLVED = 'community_report_resolved',
  // Content was reported and is waiting in the moderation queue — sent to admins.
  COMMUNITY_CONTENT_REPORTED = 'community_content_reported',
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
  // Community moderation. Post vs comment is carried by the audit row's
  // resourceType ('community_post' / 'community_comment'), not by separate actions —
  // reusing ADMIN_APPROVE/ADMIN_REJECT would leave "admin_reject on community_post"
  // ambiguous between "hid the post" and "dismissed a report about it".
  COMMUNITY_CREATED = 'community_created',
  COMMUNITY_CONTENT_HIDDEN = 'community_content_hidden',
  COMMUNITY_CONTENT_RESTORED = 'community_content_restored',
  COMMUNITY_REPORT_SUBMITTED = 'community_report_submitted',
  COMMUNITY_REPORT_RESOLVED = 'community_report_resolved',
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
  // System-written, and the only persisted status a patient never submits.
  // Set by the medication missed-sweep job once a dose's grace period elapses
  // with nothing logged, and by lazy dose-log creation for a slot that was
  // already past grace when the schedule was first read. A patient may still
  // overwrite it by logging the dose late.
  MISSED = 'missed',
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
 * How far ahead of an appointment a reminder goes out. Each member is one email a
 * patient receives for the same appointment, so the set doubles as the send schedule:
 * add a member plus its entry in APPOINTMENT_REMINDER_LEADS and the tick picks it up.
 */
export enum AppointmentReminderLead {
  ONE_DAY = 'one_day',
  ONE_HOUR = 'one_hour',
  AT_TIME = 'at_time',
}

/**
 * The same idea for a medication dose: one member per email the patient receives for
 * the same dose. Deliberately a separate enum from AppointmentReminderLead — the two
 * schedules are independent, and sharing one would make every future change to a
 * medication lead silently alter appointment sends too.
 */
export enum MedicationReminderLead {
  THIRTY_MINUTES = 'thirty_minutes',
  AT_TIME = 'at_time',
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
