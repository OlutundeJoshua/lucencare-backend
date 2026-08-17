/**
 * How one user appears on a post or comment.
 *
 * Derived at read time by CommunityService.resolveAuthors(), never snapshotted onto
 * the content row: `verified` is a live claim about a professional's standing, and a
 * struck-off professional must lose the badge on everything they ever wrote, not on
 * the next backfill.
 *
 * `displayName` is already pseudonymised for patients ("Amaka O."). The raw
 * patients.name never leaves the service.
 */
export interface AuthorDisplay {
  userId: string;
  displayName: string;
  /** First letter of displayName, so the client's avatar can never disagree with it. */
  initial: string;
  /** True only when the application is approved AND the user account is active. */
  verified: boolean;
  badge?: 'verified-professional' | 'verified-benefactor';
  specialty?: string | null;
}
