/**
 * The caller's own community numbers, for the professional and benefactor dashboards.
 *
 * Every field is a real index-backed COUNT(). None of them reads the denormalised
 * display counters on communities / community_posts — that split is the whole safety
 * argument for denormalising those: counter drift can never corrupt a number a
 * professional puts on their profile.
 *
 * All of them are computed for every caller rather than branching by role: they are cheap
 * index scans, and a role-branched shape would force the client into a discriminated
 * union to save nothing. The community portal's stat strip and both role dashboards read
 * from this one shape.
 */
export interface CommunityStatsView {
  /** Professional dashboard: "Questions answered" — comments they have written. */
  questionsAnswered: number;
  /** Benefactor dashboard and the portal strip: "Communities joined". */
  communitiesJoined: number;
  /** Both: reactions received on their own posts and comments. */
  helpfulMarks: number;
  postsWritten: number;
  /** Posts written since the start of the current calendar month. */
  postsThisMonth: number;
  /**
   * Comments other people have left on the caller's posts. The only field here that
   * joins two tables — see the note in `getStats`.
   */
  repliesReceived: number;
}
