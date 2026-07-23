import { MigrationInterface, QueryRunner } from "typeorm";

export class DefaultMedicationRemindersEnabled1784679100000 implements MigrationInterface {
    name = 'DefaultMedicationRemindersEnabled1784679100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "patients" ALTER COLUMN "medication_reminders_enabled" SET DEFAULT true`);
        await queryRunner.query(`UPDATE "patients" SET "medication_reminders_enabled" = true WHERE "medication_reminders_enabled" = false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "patients" ALTER COLUMN "medication_reminders_enabled" SET DEFAULT false`);
    }

}
