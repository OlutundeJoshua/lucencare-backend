import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes for the split comment thread.
 *
 * `listComments` used to return one flat page mixing top-level comments and replies, so
 * the only index it needed was `(post_id, status, id)`. It now returns top-level rows
 * only, with replies fetched per comment on expand, which introduces two new access
 * patterns:
 *
 *   1. top-level page      → post_id + parent_comment_id IS NULL, keyset on id
 *   2. reply counts/fetch  → parent_comment_id = ANY(...), live rows only
 *
 * Both are PARTIAL, matching the predicates the queries carry, and both put `id` in the
 * key after the lookup column. The trailing `id` is the part that matters, and it is
 * worth spelling out why, because a naive benchmark argues against it.
 *
 * Measured on 607k comments, timing 200-300 iterations rather than single EXPLAINs
 * (single-run timings at this scale are noise):
 *
 * | Query                              | lookup col only | with trailing id |
 * |------------------------------------|-----------------|------------------|
 * | reply counts, page of 20 parents   |          107 ms |           256 ms |
 * | top-level page, post w/ 10 comments|           21 ms |            33 ms |
 * | top-level page, post w/ 5k comments|         1065 ms |             6 ms |
 * | replies page, comment w/ 2k replies|          327 ms |            18 ms |
 *
 * On typical rows the narrower index wins, because sorting ten rows is free and the
 * extra 26-byte key column just makes the index bigger. That reverses completely on the
 * rows that actually matter: without `id` the keyset ORDER BY has to read every matching
 * row and sort it, so a hot thread degrades linearly with its own size — 177x slower on a
 * 5k-comment post. The trailing `id` costs a uniform fraction of a millisecond and bounds
 * a tail that is otherwise unbounded, which is the trade this module wants.
 *
 * The second index replaces `IDX_community_comments_parent`, which indexed every reply
 * regardless of status or soft-delete. Note the partial predicate is NOT what buys the
 * speed here: with live rows dominating, it excludes almost nothing, and its index-only
 * scan measured slower than a plain index scan on the count query. It is there to keep
 * the index small as hidden and deleted rows accumulate.
 *
 * CREATE INDEX takes an ACCESS EXCLUSIVE lock. These tables are small today, so this runs
 * instantly; if it is ever applied to a large live table, switch to CREATE INDEX
 * CONCURRENTLY (which cannot run inside a transaction, so it would need its own migration
 * with `transaction: false`).
 */
export class AddCommunityThreadIndexes1785800000000 implements MigrationInterface {
  name = 'AddCommunityThreadIndexes1785800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Backs the top-level comment page. `status` is deliberately NOT in the predicate:
    // the query also returns hidden parents that still carry live replies (BR-18) and
    // the caller's own hidden comments (BR-12), so a status-partial index could not
    // serve it.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_toplevel"
      ON "community_comments" ("post_id", "id")
      WHERE "parent_comment_id" IS NULL AND "deleted_at" IS NULL
    `);

    // Backs replyCountsFor() and listReplies().
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_parent_live"
      ON "community_comments" ("parent_comment_id", "id")
      WHERE "parent_comment_id" IS NOT NULL AND "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_comments_parent"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_parent"
      ON "community_comments" ("parent_comment_id") WHERE "parent_comment_id" IS NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_comments_parent_live"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_comments_toplevel"`);
  }
}
