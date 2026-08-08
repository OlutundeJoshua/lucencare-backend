import { ProgramStatus, ProgramType } from 'src/common/enums';

/**
 * A programme as the platform admin's review queue sees it.
 *
 * Carries the submitting organisation's name and contact, which the NGO-facing
 * view has no need for — an admin judging a submission has to know who sent it.
 * Deliberately not the full entity: no counters an admin cannot act on.
 */
export interface AdminProgramView {
  id: string;
  title: string;
  type: ProgramType;
  status: ProgramStatus;
  orgId: string;
  orgName: string;
  orgContactEmail: string;
  description?: string | null;
  focus?: string | null;
  donor?: string | null;
  coordinator?: string | null;
  eligibilityCriteria: object[];
  /** MINOR units (kobo). */
  budgetTotal?: number | null;
  slotsTotal?: number | null;
  expiresAt: string;
  createdAt: string;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
}
