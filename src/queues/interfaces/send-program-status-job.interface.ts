/**
 * Payload for SEND_PROGRAM_STATUS_JOB — the platform's decision on a programme,
 * emailed to the NGO staff who submitted it.
 */
export interface SendProgramStatusJob {
  to: string;
  recipientName: string;
  programTitle: string;
  approved: boolean;
  /** Present on a rejection only. */
  reason?: string;
}
