export enum UserRole {
  PATIENT = 'patient',
  NGO_ADMIN = 'ngo_admin',
  HMO_COORDINATOR = 'hmo_coordinator',
  RESEARCHER = 'researcher',
  PLATFORM_ADMIN = 'platform_admin',
}

export enum OrgType {
  NGO = 'ngo',
  HMO = 'hmo',
}

export enum OrgStatus {
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
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
  HMO_LINK_REQUEST = 'hmo_link_request',
}

export enum AuditAction {
  EXPORT = 'export',
  REVOKE_CONSENT = 'revoke_consent',
  ADMIN_APPROVE = 'admin_approve',
  ADMIN_REJECT = 'admin_reject',
  LOGIN = 'login',
  CONSENT_CHANGE = 'consent_change',
  CROSS_ORG_ATTEMPT = 'cross_org_attempt',
}

export enum TokenPurpose {
  PDF_EXPORT = 'pdf_export',
  OTP_VERIFY = 'otp_verify',
}
