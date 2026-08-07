import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an NGO record a decision on an application.
 *
 * `status` is plain varchar with no CHECK constraint, so the three new
 * EnrollmentStatus values (selected / waitlisted / rejected) need no column change —
 * only the reviewer's audit trail does.
 *
 * Existing rows keep status 'active', which now means "applied, awaiting decision".
 * That is the same thing it meant before, so no backfill is required.
 */
export class AddEnrollmentReviewFields1785300000000 implements MigrationInterface {
  name = 'AddEnrollmentReviewFields1785300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "rejection_reason" text`);
    await queryRunner.query(`ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "reviewed_by" character(26)`);

    // A rejection without a reason leaves the patient with no way to act, and the
    // API requires one — enforce it in the database too so no path can bypass it.
    await queryRunner.query(`
      ALTER TABLE "enrollments"
      ADD CONSTRAINT "chk_enrollments_rejection_reason"
      CHECK ("status" <> 'rejected' OR "rejection_reason" IS NOT NULL)
    `);

    // The applicant queue is read per programme filtered by status.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_enrollments_program_status"
      ON "enrollments" ("program_id", "status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_enrollments_program_status"`);
    await queryRunner.query(
      `ALTER TABLE "enrollments" DROP CONSTRAINT IF EXISTS "chk_enrollments_rejection_reason"`,
    );
    for (const col of ['reviewed_by', 'reviewed_at', 'rejection_reason']) {
      await queryRunner.query(`ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
