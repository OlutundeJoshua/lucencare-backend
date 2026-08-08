import { ReviewableEnrollmentStatus } from 'src/common/enums';

/** The outcome of one patient's application to one programme. */
export interface SendEnrollmentOutcomeJob {
  to: string;
  patientName: string;
  programTitle: string;
  status: ReviewableEnrollmentStatus;
  /** Present only on a rejection — the same reason shown in-app. */
  reason?: string;
}
