import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDueNowToDoseStatusEnum1784679078587 implements MigrationInterface {
    name = 'AddDueNowToDoseStatusEnum1784679078587'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."medication_dose_logs_status_enum" ADD VALUE IF NOT EXISTS 'due_now'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`CREATE TYPE "public"."medication_dose_logs_status_enum_old" AS ENUM('taken', 'pending', 'later', 'skipped')`);
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" TYPE "public"."medication_dose_logs_status_enum_old" USING "status"::text::"public"."medication_dose_logs_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."medication_dose_logs_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."medication_dose_logs_status_enum_old" RENAME TO "medication_dose_logs_status_enum"`);
        await queryRunner.query(`ALTER TABLE "medication_dose_logs" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    }

}
