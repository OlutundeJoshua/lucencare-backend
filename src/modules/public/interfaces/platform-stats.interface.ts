/**
 * Aggregate counts safe to show an anonymous visitor on the marketing page.
 *
 * Totals only. Nothing here is per-patient or per-organisation, and nothing new
 * may be added to this shape without the same test: could a stranger learn
 * something about an individual from it?
 */
export interface PlatformStats {
  /** Registered patients, excluding soft-deleted rows. */
  patients: number;

  /** NGO programmes an admin has approved. Drafts and pending ones do not count. */
  ngoPrograms: number;
}
