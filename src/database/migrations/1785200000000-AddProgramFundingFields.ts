import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives programmes the detail an NGO actually manages — budget, capacity, donor and
 * coordinator — none of which had a column, so the NGO Programs screen was rendering
 * numbers the API could not store or return.
 *
 * All columns are nullable or defaulted: existing rows must survive untouched.
 *
 * Money is bigint in MINOR units (kobo). Floating point cannot represent currency
 * exactly and a budget that drifts by rounding is worse than no budget at all.
 */
export class AddProgramFundingFields1785200000000 implements MigrationInterface {
  name = 'AddProgramFundingFields1785200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Descriptive detail
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "description" text`);
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "focus" text`);
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "donor" text`);
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "coordinator" text`);

    // Funding
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "budget_total" bigint`);
    await queryRunner.query(
      `ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "budget_disbursed" bigint NOT NULL DEFAULT 0`,
    );

    // Capacity. slots_filled is maintained by the platform as patients are selected.
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "slots_total" integer`);
    await queryRunner.query(
      `ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "slots_filled" integer NOT NULL DEFAULT 0`,
    );

    // Lifecycle: the only display state that cannot be derived from other data.
    await queryRunner.query(`ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "paused_at" timestamptz`);

    // Guard the invariants in the database, not just in the service — a negative
    // budget or an over-filled programme is corrupt data, not a validation slip.
    await queryRunner.query(`
      ALTER TABLE "programs"
      ADD CONSTRAINT "chk_programs_budget_nonneg"
      CHECK ("budget_total" IS NULL OR ("budget_total" >= 0 AND "budget_disbursed" >= 0))
    `);
    await queryRunner.query(`
      ALTER TABLE "programs"
      ADD CONSTRAINT "chk_programs_slots_nonneg"
      CHECK ("slots_total" IS NULL OR ("slots_total" >= 0 AND "slots_filled" >= 0))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "programs" DROP CONSTRAINT IF EXISTS "chk_programs_slots_nonneg"`);
    await queryRunner.query(`ALTER TABLE "programs" DROP CONSTRAINT IF EXISTS "chk_programs_budget_nonneg"`);

    for (const col of [
      'paused_at',
      'slots_filled',
      'slots_total',
      'budget_disbursed',
      'budget_total',
      'coordinator',
      'donor',
      'focus',
      'description',
    ]) {
      await queryRunner.query(`ALTER TABLE "programs" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
