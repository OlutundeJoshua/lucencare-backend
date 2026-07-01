import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBenefactorApplicationTable1751380003000 implements MigrationInterface {
  name = 'CreateBenefactorApplicationTable1751380003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "benefactor_applications" (
        "id"                  char(26)      NOT NULL,
        "user_id"             char(26)      NOT NULL,
        "full_name"           text          NOT NULL,
        "phone"               varchar(30)   NOT NULL,
        "reason_for_support"  text          NOT NULL,
        "id_consent_given"    boolean       NOT NULL DEFAULT false,
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
        CONSTRAINT "PK_benefactor_applications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_benefactor_applications_user_id" UNIQUE ("user_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_benefactor_applications_status" ON "benefactor_applications" ("status")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_benefactor_applications_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "benefactor_applications"`);
  }
}
