import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Programmes gain a real draft state and a record of the platform's decision.
 *
 * `status` is plain varchar with no enum type, so the new 'draft' value needs no
 * column change — only the default moves. Existing rows are deliberately left
 * alone: anything already 'pending_review' really was submitted, and re-labelling
 * it as a draft would silently withdraw it from the admin queue.
 *
 * The rejection-reason CHECK is added NOT VALID so it governs every new write
 * without failing the migration on a programme rejected before the column existed.
 */
export class AddProgramDraftAndReviewFields1785500000000 implements MigrationInterface {
  name = 'AddProgramDraftAndReviewFields1785500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "programs" ALTER COLUMN "status" SET DEFAULT 'draft'`);

    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "rejection_reason" text`);
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "reviewed_by" character(26)`);

    await queryRunner.query(`
      ALTER TABLE "programs"
      ADD CONSTRAINT "chk_programs_rejection_reason"
      CHECK ("status" <> 'rejected' OR "rejection_reason" IS NOT NULL)
      NOT VALID
    `);

    // The admin queue reads pending programmes newest-first across every org.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_programs_status_id"
      ON "programs" ("status", "id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_programs_status_id"`);
    await queryRunner.query(
      `ALTER TABLE "programs" DROP CONSTRAINT IF EXISTS "chk_programs_rejection_reason"`,
    );
    await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN IF EXISTS "reviewed_by"`);
    await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN IF EXISTS "reviewed_at"`);
    await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN IF EXISTS "rejection_reason"`);
    await queryRunner.query(
      `ALTER TABLE "programs" ALTER COLUMN "status" SET DEFAULT 'pending_review'`,
    );
  }
}
