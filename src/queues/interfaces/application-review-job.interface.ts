/**
 * Tells platform admins a professional or benefactor application needs review.
 * The organisation equivalent is OrgVerificationJob.
 */
export interface ApplicationReviewJob {
  applicationId: string;
  /** Matches the audit log's resourceType vocabulary. */
  applicationType: 'professional_application' | 'benefactor_application';
  applicantName: string;
  applicantEmail: string;
}
