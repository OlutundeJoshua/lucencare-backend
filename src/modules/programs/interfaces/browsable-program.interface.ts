/**
 * A programme as a patient browsing for funding sees it.
 *
 * Everything here is the NGO's own published description of what it offers —
 * enough to decide whether to apply. What is absent is absent on purpose:
 *
 * - `budgetTotal` / `budgetDisbursed` — the size of the fund reads as a promise of
 *   what one person receives, and no per-patient award is modelled.
 * - `eligibilityCriteria` — matcher configuration (`{ field, operator, value }`),
 *   not patient-facing copy.
 * - `status`, `pausedAt`, `rejectionReason`, `reviewedAt`, `reviewedBy` — the NGO's
 *   private correspondence with the platform. A patient only ever sees programmes
 *   that are approved and unpaused, so the review trail tells them nothing.
 *
 * `orgName` is joined from `organizations`: `orgId` alone is an opaque ULID, and no
 * patient-reachable endpoint resolves it, so without this a patient could not tell
 * who was offering the programme.
 */
export interface BrowsableProgram {
  id: string;
  title: string;
  type: string;
  orgId: string;
  orgName: string;
  expiresAt: Date;
  slotsTotal?: number | null;
  slotsFilled: number;
  description?: string | null;
  focus?: string | null;
  donor?: string | null;
  coordinator?: string | null;
}
