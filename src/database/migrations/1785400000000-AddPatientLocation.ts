import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structured patient location, for eligibility matching and the NGO coverage map.
 *
 * Both columns are nullable and there is NO backfill: every existing patient has only
 * free-text `address`, which cannot be parsed into a state reliably enough to guess.
 * Unlocated patients are counted in an explicit "Unspecified" bucket rather than
 * silently dropped from totals.
 *
 * Location is deliberately NOT added to SNAPSHOT_FIELDS — organisations receive counts
 * per state, never a patient's own state.
 */
export class AddPatientLocation1785400000000 implements MigrationInterface {
  name = 'AddPatientLocation1785400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "location_state" text`);
    await queryRunner.query(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "location_lga" text`);

    // Eligibility criteria filter on state, and the map groups by it.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_patients_location_state"
      ON "patients" ("location_state")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_patients_location_state"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN IF EXISTS "location_lga"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN IF EXISTS "location_state"`);
  }
}
