/**
 * What an NGO sees of an applicant: the point-in-time snapshot captured when the
 * patient enrolled, plus the review state.
 *
 * `patientId` and `consentGrantId` are deliberately absent — CLAUDE.md §8 forbids
 * serving an org anything but the snapshot, so the org cannot correlate applicants
 * across programmes or reach the live patient record.
 */
export interface EnrollmentSnapshot {
  id: string;
  status: string;
  sharedDataSnapshot: Record<string, unknown>;
  createdAt: string;
  /** Present once rejected — the NGO's own stated reason, echoed back to them. */
  rejectionReason?: string;
  reviewedAt?: string;
}
