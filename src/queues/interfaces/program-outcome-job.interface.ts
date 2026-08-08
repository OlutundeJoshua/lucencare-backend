/**
 * Payload for PROGRAM_APPROVED_JOB and PROGRAM_REJECTED_JOB — the platform's
 * decision on a submitted programme, on its way back to the NGO.
 *
 * Carries `orgId` rather than a user id: the old payload used `program.createdBy`,
 * which is null for anything created outside a CLS-bearing request, so the notice
 * had no recipient. Staff are resolved from the organisation instead.
 */
export interface ProgramOutcomeJob {
  programId: string;
  orgId: string;
  programTitle: string;
  /** Present on a rejection only. */
  reason?: string;
}
