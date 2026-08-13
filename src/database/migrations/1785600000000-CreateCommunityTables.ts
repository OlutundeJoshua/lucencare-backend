import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The community: six new tables. Nothing existing is touched.
 *
 * Three decisions worth reading before changing anything here.
 *
 * **Partial unique indexes, not plain ones.** Leaving a community and un-hiding a
 * report are soft deletes, so a plain UNIQUE on (community_id, user_id) would make
 * rejoining after leaving impossible. Every uniqueness rule below is scoped with a
 * WHERE clause to the rows it actually governs.
 *
 * **Two indexes on community_reactions, not one composite.** Postgres treats NULLs
 * as distinct, so a UNIQUE over (user_id, post_id, comment_id) constrains nothing —
 * a user could like the same post any number of times. One partial index per target
 * column is the only shape that works.
 *
 * **No RLS.** CLAUDE.md §6.5 scopes RLS to org- and patient-scoped tables. Community
 * content is participant-public by design: every member is meant to read every post
 * in a community they joined. A policy here would encode no real boundary, so its
 * absence is deliberate rather than an oversight. The access boundary that DOES
 * matter — no ngo_admin, hmo_coordinator or researcher may read any of this — is
 * enforced at the controller's class-level RoleGuard.
 *
 * CHECKs are added NOT VALID for consistency with the rest of this repo's migrations;
 * on empty tables it makes no difference, and it keeps the pattern uniform if these
 * are ever re-run against seeded data.
 */
export class CreateCommunityTables1785600000000 implements MigrationInterface {
  name = 'CreateCommunityTables1785600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── communities ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "communities" (
        "id"                  character(26) NOT NULL,
        "created_at"          timestamptz   NOT NULL DEFAULT now(),
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        "created_by"          character(26),
        "updated_by"          character(26),
        "name"                text          NOT NULL,
        "slug"                text          NOT NULL,
        "description"         text,
        "icon"                text,
        "accent"              text,
        "disclaimer"          text,
        "tags"                text[]        NOT NULL DEFAULT '{}',
        "status"              varchar       NOT NULL DEFAULT 'active',
        "member_count"        integer       NOT NULL DEFAULT 0,
        "post_count"          integer       NOT NULL DEFAULT 0,
        "created_by_user_id"  character(26) NOT NULL,
        CONSTRAINT "PK_communities" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_communities_slug"
      ON "communities" ("slug") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_communities_status_id"
      ON "communities" ("status", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_communities_tags"
      ON "communities" USING GIN ("tags")
    `);

    // ── community_memberships ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_memberships" (
        "id"                  character(26) NOT NULL,
        "created_at"          timestamptz   NOT NULL DEFAULT now(),
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        "created_by"          character(26),
        "updated_by"          character(26),
        "community_id"        character(26) NOT NULL,
        "user_id"             character(26) NOT NULL,
        "joined_at"           timestamptz   NOT NULL DEFAULT now(),
        "code_of_conduct_at"  timestamptz,
        CONSTRAINT "PK_community_memberships" PRIMARY KEY ("id")
      )
    `);
    // Partial: leaving soft-deletes the row, and a plain unique index would then
    // make rejoining impossible.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_memberships_community_user"
      ON "community_memberships" ("community_id", "user_id") WHERE "deleted_at" IS NULL
    `);
    // Backs the "Communities joined" dashboard count.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_memberships_user"
      ON "community_memberships" ("user_id") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_memberships_community"
      ON "community_memberships" ("community_id") WHERE "deleted_at" IS NULL
    `);

    // ── community_posts ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_posts" (
        "id"                character(26) NOT NULL,
        "created_at"        timestamptz   NOT NULL DEFAULT now(),
        "updated_at"        timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"        timestamptz,
        "created_by"        character(26),
        "updated_by"        character(26),
        "community_id"      character(26) NOT NULL,
        "author_user_id"    character(26) NOT NULL,
        "title"             text,
        "body"              text          NOT NULL,
        "tags"              text[]        NOT NULL DEFAULT '{}',
        "status"            varchar       NOT NULL DEFAULT 'published',
        "hidden_at"         timestamptz,
        "hidden_by"         character(26),
        "hidden_reason"     text,
        "comment_count"     integer       NOT NULL DEFAULT 0,
        "reaction_count"    integer       NOT NULL DEFAULT 0,
        "last_activity_at"  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_community_posts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_posts"
      ADD CONSTRAINT "chk_community_posts_hidden"
      CHECK ("status" <> 'hidden' OR "hidden_at" IS NOT NULL)
      NOT VALID
    `);
    // Btree scans backwards at no cost, so these serve the id DESC keyset feeds
    // without a DESC in the definition.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_posts_community_status_id"
      ON "community_posts" ("community_id", "status", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_posts_status_id"
      ON "community_posts" ("status", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_posts_author_status"
      ON "community_posts" ("author_user_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_posts_tags"
      ON "community_posts" USING GIN ("tags")
    `);

    // ── community_comments ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_comments" (
        "id"                 character(26) NOT NULL,
        "created_at"         timestamptz   NOT NULL DEFAULT now(),
        "updated_at"         timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        "created_by"         character(26),
        "updated_by"         character(26),
        "post_id"            character(26) NOT NULL,
        "parent_comment_id"  character(26),
        "community_id"       character(26) NOT NULL,
        "author_user_id"     character(26) NOT NULL,
        "body"               text          NOT NULL,
        "status"             varchar       NOT NULL DEFAULT 'published',
        "hidden_at"          timestamptz,
        "hidden_by"          character(26),
        "hidden_reason"      text,
        "reaction_count"     integer       NOT NULL DEFAULT 0,
        CONSTRAINT "PK_community_comments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_comments"
      ADD CONSTRAINT "chk_community_comments_hidden"
      CHECK ("status" <> 'hidden' OR "hidden_at" IS NOT NULL)
      NOT VALID
    `);
    // The one-level nesting rule cannot be a CHECK — it would have to read another
    // row of this same table. CommunityService.createComment() re-parents a reply to
    // a reply onto its top-level ancestor, and a unit test pins that.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_post_status_id"
      ON "community_comments" ("post_id", "status", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_parent"
      ON "community_comments" ("parent_comment_id") WHERE "parent_comment_id" IS NOT NULL
    `);
    // Backs the "Questions answered" dashboard count.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_comments_author_status"
      ON "community_comments" ("author_user_id", "status")
    `);

    // ── community_reactions ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_reactions" (
        "id"                     character(26) NOT NULL,
        "created_at"             timestamptz   NOT NULL DEFAULT now(),
        "updated_at"             timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"             timestamptz,
        "created_by"             character(26),
        "updated_by"             character(26),
        "user_id"                character(26) NOT NULL,
        "post_id"                character(26),
        "comment_id"             character(26),
        "target_author_user_id"  character(26) NOT NULL,
        "type"                   varchar       NOT NULL DEFAULT 'like',
        CONSTRAINT "PK_community_reactions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reactions"
      ADD CONSTRAINT "chk_community_reactions_target"
      CHECK (num_nonnulls("post_id", "comment_id") = 1)
      NOT VALID
    `);
    // One index per target column. A composite over both nullable columns would
    // constrain nothing, because Postgres treats NULLs as distinct in a unique index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_reactions_user_post"
      ON "community_reactions" ("user_id", "post_id", "type") WHERE "post_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_reactions_user_comment"
      ON "community_reactions" ("user_id", "comment_id", "type") WHERE "comment_id" IS NOT NULL
    `);
    // Backs "Helpful marks" as a single index-only count.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reactions_target_author"
      ON "community_reactions" ("target_author_user_id")
    `);

    // ── community_reports ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_reports" (
        "id"                 character(26) NOT NULL,
        "created_at"         timestamptz   NOT NULL DEFAULT now(),
        "updated_at"         timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"         timestamptz,
        "created_by"         character(26),
        "updated_by"         character(26),
        "reporter_user_id"   character(26) NOT NULL,
        "post_id"            character(26),
        "comment_id"         character(26),
        "community_id"       character(26) NOT NULL,
        "reason"             varchar       NOT NULL,
        "details"            text,
        "status"             varchar       NOT NULL DEFAULT 'pending',
        "resolution_note"    text,
        "reviewed_at"        timestamptz,
        "reviewed_by"        character(26),
        CONSTRAINT "PK_community_reports" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reports"
      ADD CONSTRAINT "chk_community_reports_target"
      CHECK (num_nonnulls("post_id", "comment_id") = 1)
      NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reports"
      ADD CONSTRAINT "chk_community_reports_reviewed"
      CHECK ("status" = 'pending' OR "reviewed_at" IS NOT NULL)
      NOT VALID
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reports_status_id"
      ON "community_reports" ("status", "id")
    `);
    // Used to close every pending report on a target in one statement when an admin
    // hides it — one action resolves the whole pile.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reports_post"
      ON "community_reports" ("post_id") WHERE "post_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_community_reports_comment"
      ON "community_reports" ("comment_id") WHERE "comment_id" IS NOT NULL
    `);
    // One open complaint per reporter per target. A repeat is a 409, not a new row.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_reports_open_post"
      ON "community_reports" ("reporter_user_id", "post_id")
      WHERE "post_id" IS NOT NULL AND "status" = 'pending' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_community_reports_open_comment"
      ON "community_reports" ("reporter_user_id", "comment_id")
      WHERE "comment_id" IS NOT NULL AND "status" = 'pending' AND "deleted_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "community_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "community_reactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "community_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "community_posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "community_memberships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "communities"`);
  }
}
