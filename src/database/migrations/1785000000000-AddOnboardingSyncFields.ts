import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingSyncFields1785000000000 implements MigrationInterface {
  name = 'AddOnboardingSyncFields1785000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // users — display name for every role (PATIENT also keeps patients.name)
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" text`);

    // organizations — NGO fields collected by the onboarding wizard but never stored
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "tin" varchar(50)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "scuml_number" varchar(100)`);

    // organizations — admin rejection reason (previously only in audit_log)
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "rejection_reason" text`);

    // organizations — consent timestamps
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "terms_consent_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "data_processing_consent_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "baa_acknowledged_at" timestamptz`);

    // varchar(10) is too narrow for the free-text values the DTOs accept
    // (e.g. "United Kingdom") — a latent "value too long" 500.
    await queryRunner.query(`ALTER TABLE "organizations" ALTER COLUMN "head_office_country" TYPE varchar(100)`);
    await queryRunner.query(`ALTER TABLE "organizations" ALTER COLUMN "coverage_region" TYPE varchar(100)`);

    // professional_applications — consent timestamps
    await queryRunner.query(
      `ALTER TABLE "professional_applications" ADD COLUMN IF NOT EXISTS "terms_consent_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "professional_applications" ADD COLUMN IF NOT EXISTS "code_of_conduct_consent_at" timestamptz`,
    );

    // benefactor_applications — consent timestamps
    await queryRunner.query(
      `ALTER TABLE "benefactor_applications" ADD COLUMN IF NOT EXISTS "id_consent_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "benefactor_applications" ADD COLUMN IF NOT EXISTS "terms_consent_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "benefactor_applications" ADD COLUMN IF NOT EXISTS "code_of_conduct_consent_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "benefactor_applications" DROP COLUMN IF EXISTS "code_of_conduct_consent_at"`,
    );
    await queryRunner.query(`ALTER TABLE "benefactor_applications" DROP COLUMN IF EXISTS "terms_consent_at"`);
    await queryRunner.query(`ALTER TABLE "benefactor_applications" DROP COLUMN IF EXISTS "id_consent_at"`);

    await queryRunner.query(
      `ALTER TABLE "professional_applications" DROP COLUMN IF EXISTS "code_of_conduct_consent_at"`,
    );
    await queryRunner.query(`ALTER TABLE "professional_applications" DROP COLUMN IF EXISTS "terms_consent_at"`);

    // Truncate before narrowing, otherwise the revert fails on any row that used
    // the extra width this migration made available.
    await queryRunner.query(`UPDATE "organizations" SET "coverage_region" = left("coverage_region", 10)`);
    await queryRunner.query(`ALTER TABLE "organizations" ALTER COLUMN "coverage_region" TYPE varchar(10)`);
    await queryRunner.query(`UPDATE "organizations" SET "head_office_country" = left("head_office_country", 10)`);
    await queryRunner.query(`ALTER TABLE "organizations" ALTER COLUMN "head_office_country" TYPE varchar(10)`);

    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "baa_acknowledged_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "data_processing_consent_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "terms_consent_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "scuml_number"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "tin"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "name"`);
  }
}
