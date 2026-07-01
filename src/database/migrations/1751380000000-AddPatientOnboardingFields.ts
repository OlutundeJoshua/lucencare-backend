import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatientOnboardingFields1751380000000 implements MigrationInterface {
  name = 'AddPatientOnboardingFields1751380000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Make phone nullable (self-registered patients don't provide phone at signup)
    await queryRunner.query(`ALTER TABLE "patients" ALTER COLUMN "phone" DROP NOT NULL`);

    await queryRunner.query(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "country" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "primary_language" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "is_caregiver" boolean NOT NULL DEFAULT false`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN IF EXISTS "is_caregiver"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN IF EXISTS "primary_language"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN IF EXISTS "country"`);
    await queryRunner.query(`ALTER TABLE "patients" ALTER COLUMN "phone" SET NOT NULL`);
  }
}
