import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAppointmentsTable1784333936578 implements MigrationInterface {
    name = 'CreateAppointmentsTable1784333936578'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DO $$ BEGIN CREATE TYPE "public"."appointments_type_enum" AS ENUM('consultation', 'follow_up', 'lab_test', 'physiotherapy', 'specialist_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
        await queryRunner.query(`DO $$ BEGIN CREATE TYPE "public"."appointments_status_enum" AS ENUM('confirmed', 'pending', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "appointments" ("id" character(26) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" character(26), "updated_by" character(26), "patient_id" character(26) NOT NULL, "appointment_date" date NOT NULL, "time" text NOT NULL, "duration" text NOT NULL, "provider" text NOT NULL, "specialty" text NOT NULL, "facility" text NOT NULL, "type" "public"."appointments_type_enum" NOT NULL, "status" "public"."appointments_status_enum" NOT NULL DEFAULT 'confirmed', "note" text, CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_3959a00670b72158c332ba1107" ON "appointments" ("patient_id", "appointment_date")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_3330f054416745deaa2cc13070" ON "appointments" ("patient_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_3330f054416745deaa2cc13070"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3959a00670b72158c332ba1107"`);
        await queryRunner.query(`DROP TABLE "appointments"`);
        await queryRunner.query(`DROP TYPE "public"."appointments_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."appointments_type_enum"`);
    }

}
