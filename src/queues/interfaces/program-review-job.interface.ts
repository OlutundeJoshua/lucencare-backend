/**
 * Payload for PROGRAM_REVIEW_JOB — an NGO submitted a funding programme and the
 * platform admins need to know.
 *
 * The producer used to pass an inline object literal, so nothing kept it in step
 * with what the processor read.
 */
export interface ProgramReviewJob {
  programId: string;
  orgId: string;
  title: string;
}
