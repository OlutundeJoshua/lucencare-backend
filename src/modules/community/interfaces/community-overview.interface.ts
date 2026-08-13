/**
 * The four tiles across the top of the community portal.
 *
 * Platform-wide, not per-user — they answer "is anyone here?" for someone deciding
 * whether to join in. Until now the template carried four hardcoded literals.
 */
export interface CommunityOverviewView {
  /** Distinct users holding at least one active membership. */
  memberCount: number;
  postsThisWeek: number;
  /** Posts with at least one comment in the last 7 days. */
  activeDiscussions: number;
  communityCount: number;
}
