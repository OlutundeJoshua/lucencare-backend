/**
 * One row of the Trending tab: a tag and how many published posts carried it in the
 * trailing window. Computed by unnesting community_posts.tags, so it can never drift
 * from what the feed actually contains — the mock it replaces listed tags that
 * appeared on no post at all.
 */
export interface TrendingTag {
  tag: string;
  count: number;
}
