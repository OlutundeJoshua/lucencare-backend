import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three indexes the community module needs once the tables are not empty.
 *
 * Measured against a 1M-post / 2M-comment / 2M-reaction dataset with the same DDL:
 *
 * | Query                                   | Before  | After  |
 * |-----------------------------------------|---------|--------|
 * | overview: postsThisWeek                 |  736 ms | 7.9 ms |
 * | overview: activeDiscussions             | 1346 ms |  29 ms |  (+ the GROUP BY rewrite)
 * | trending: tag counts                    |  523 ms |  95 ms |
 * | stats: helpfulMarks (4k reactions)      |   18 ms | 2.3 ms |
 *
 * The first three ran as parallel sequential scans because every "this week"
 * aggregate filters on created_at, which nothing indexed. They sit on the community
 * portal's hot path — every load, every user — so a seq scan over the whole posts
 * and comments tables was the module's first real scaling cliff.
 *
 * All three are PARTIAL, matching the predicate the queries actually use. That keeps
 * them small (they cover only live, published rows) and, for the reactions one, lets
 * the count run as a true index-only scan: with the predicate in the WHERE clause
 * instead, `deleted_at IS NULL` forced a heap fetch per row and the "index-only"
 * claim in the original comment was simply wrong.
 *
 * CREATE INDEX takes an ACCESS EXCLUSIVE lock. These tables are small today, so this
 * runs instantly; if it is ever applied to a large live table, switch to
 * CREATE INDEX CONCURRENTLY (which cannot run inside a transaction, so it would need
 * its own migration with `transaction: false`).
 */
export class AddCommunityPerformanceIndexes1785700000000 implements MigrationInterface {
  name = 'AddCommunityPerformanceIndexes1785700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Backs overview.postsThisWeek and the whole of getTrending(). INCLUDE (tags)
    // lets the trending aggregate read tags off the index instead of the heap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_posts_recent"
      ON "community_posts" ("created_at") INCLUDE ("tags")
      WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);

    // Backs overview.activeDiscussions. post_id is in the key, not INCLUDE, because
    // the query groups by it.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_recent"
      ON "community_comments" ("created_at", "post_id")
      WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);

    // Backs stats.helpfulMarks. Partial so the count is index-only — reactions are
    // hard-deleted, so every live row satisfies the predicate anyway.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reactions_target_author_live"
      ON "community_reactions" ("target_author_user_id")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_reactions_target_author"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reactions_target_author"
      ON "community_reactions" ("target_author_user_id")
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_reactions_target_author_live"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_comments_recent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_posts_recent"`);
  }
}
