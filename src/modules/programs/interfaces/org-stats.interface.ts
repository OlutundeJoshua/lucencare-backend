/**
 * The NGO dashboard's headline numbers, counted in SQL.
 *
 * Aggregates only — never a patient row, never an id. The dashboard is the one NGO
 * screen with no consent context at all, so it must not be able to leak one.
 */
export interface OrgStats {
  /** Programmes that are approved, unpaused and not past their closing date. */
  activePrograms: number;
  totalPrograms: number;
  /** Every application ever received across this org's programmes. */
  totalApplicants: number;
  /** Applications with no decision yet — the reviewer's queue depth. */
  pendingReview: number;
  selectedPatients: number;
  waitlisted: number;
  rejected: number;
  /** MINOR units (kobo), summed across programmes. */
  budgetTotal: number;
  budgetDisbursed: number;
  slotsTotal: number;
  slotsFilled: number;
}
