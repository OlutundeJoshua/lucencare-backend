import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProfessionalApplicationTable1751380002000 implements MigrationInterface {
  name = 'CreateProfessionalApplicationTable1751380002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "professional_applications" (
        "id"                  char(26)      NOT NULL,
        "user_id"             char(26)      NOT NULL,
        "profession"          varchar       NOT NULL,
        "license_number"      text          NOT NULL,
        "specialty"           text          NOT NULL,
        "years_of_experience" integer       NOT NULL,
        "phone"               varchar(30)   NOT NULL,
        "bio"                 text          NOT NULL,
        "status"              varchar       NOT NULL DEFAULT 'pending',
        "rejection_reason"    text,
        "submitted_at"        timestamptz   NOT NULL DEFAULT NOW(),
        "reviewed_at"         timestamptz,
        "reviewed_by"         char(26),
        "created_at"          timestamptz   NOT NULL DEFAULT NOW(),
        "updated_at"          timestamptz   NOT NULL DEFAULT NOW(),
        "deleted_at"          timestamptz,
        "created_by"          char(26),
        "updated_by"          char(26),
        CONSTRAINT "PK_professional_applications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_professional_applications_user_id" UNIQUE ("user_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_professional_applications_status" ON "professional_applications" ("status")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_professional_applications_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "professional_applications"`);
  }
}
