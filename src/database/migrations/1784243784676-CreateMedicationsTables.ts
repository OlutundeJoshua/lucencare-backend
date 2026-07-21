import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMedicationsTables1784243784676 implements MigrationInterface {
    name = 'CreateMedicationsTables1784243784676'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "medications" ("id" character(26) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" character(26), "updated_by" character(26), "patient_id" character(26) NOT NULL, "name" text NOT NULL, "dosage" text NOT NULL, "condition" text NOT NULL, "frequency" text NOT NULL, "schedule_times" text array NOT NULL DEFAULT '{}', "prescriber" text NOT NULL, "specialty" text NOT NULL, "pills_remaining" integer NOT NULL, "pills_total" integer NOT NULL, "refill_date" date NOT NULL, "rxnorm_code" text, "notes" text, CONSTRAINT "PK_cdee49fe7cd79db13340150d356" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3130066025b515af290c5bf190" ON "medications" ("patient_id") `);
        await queryRunner.query(`CREATE TYPE "public"."medication_dose_logs_status_enum" AS ENUM('taken', 'pending', 'later', 'skipped')`);
        await queryRunner.query(`CREATE TABLE "medication_dose_logs" ("id" character(26) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" character(26), "updated_by" character(26), "medication_id" character(26) NOT NULL, "patient_id" character(26) NOT NULL, "dose_date" date NOT NULL, "scheduled_time" text NOT NULL, "status" "public"."medication_dose_logs_status_enum" NOT NULL DEFAULT 'pending', "taken_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_73c20208a99b26b86446460222b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1e893b87b5319993bd222071d4" ON "medication_dose_logs" ("medication_id", "dose_date", "scheduled_time") `);
        await queryRunner.query(`CREATE INDEX "IDX_5291c349f63d52282a94a4e779" ON "medication_dose_logs" ("medication_id", "dose_date") `);
        await queryRunner.query(`CREATE INDEX "IDX_7631867d08b64366bb4f5e6227" ON "medication_dose_logs" ("patient_id", "dose_date") `);
        await queryRunner.query(`ALTER TABLE "patients" ADD "timezone" text`);
        await queryRunner.query(`ALTER TABLE "patients" ADD "medication_reminders_enabled" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "medication_reminders_enabled"`);
        await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "timezone"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7631867d08b64366bb4f5e6227"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5291c349f63d52282a94a4e779"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e893b87b5319993bd222071d4"`);
        await queryRunner.query(`DROP TABLE "medication_dose_logs"`);
        await queryRunner.query(`DROP TYPE "public"."medication_dose_logs_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3130066025b515af290c5bf190"`);
        await queryRunner.query(`DROP TABLE "medications"`);
    }

}
