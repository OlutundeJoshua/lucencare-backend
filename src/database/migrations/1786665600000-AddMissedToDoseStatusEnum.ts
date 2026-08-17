import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissedToDoseStatusEnum1786665600000 implements MigrationInterface {
    name = 'AddMissedToDoseStatusEnum1786665600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."medication_dose_logs_status_enum" ADD VALUE IF NOT EXISTS 'missed'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Unlike 'due_now', 'missed' is genuinely persisted, so rows have to be
        // rewritten before the type can be narrowed or the cast below fails.
        // 'pending' is the pre-migration state these rows would have been in.
        await queryRunner.query(`UPDATE "medication_dose_logs" SET "status" = 'pending' WHERE "status" = 'missed'`);
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`CREATE TYPE "public"."medication_dose_logs_status_enum_old" AS ENUM('taken', 'pending', 'later', 'skipped', 'due_now')`);
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" TYPE "public"."medication_dose_logs_status_enum_old" USING "status"::text::"public"."medication_dose_logs_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."medication_dose_logs_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."medication_dose_logs_status_enum_old" RENAME TO "medication_dose_logs_status_enum"`);
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    }

}
