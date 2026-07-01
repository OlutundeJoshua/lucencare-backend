import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgOnboardingFields1751380001000 implements MigrationInterface {
  name = 'AddOrgOnboardingFields1751380001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Shared
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "registration_number" text`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "contact_phone" varchar(30)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "website" varchar(500)`);

    // NGO-specific
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "focus_areas" text`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "operating_regions" text`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "head_office_country" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "program_description" text`);

    // HMO-specific
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "licence_number" text`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "coverage_region" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "enrolled_patient_count" varchar(20)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "specialty_focus" text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "specialty_focus"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "enrolled_patient_count"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "coverage_region"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "licence_number"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "program_description"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "head_office_country"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "operating_regions"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "focus_areas"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "website"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "contact_phone"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "registration_number"`);
  }
}
