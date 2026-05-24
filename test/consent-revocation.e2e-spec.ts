// TODO: Implement — see docs/modules/consents.md

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

import { AppModule } from 'src/app.module';

describe('Consent Revocation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH /api/v1/consents/:id — revocation tombstones linked enrollments atomically', async () => {
    // TODO: Verify single transaction: status update + enrollment tombstones + audit log
  });

  it('PATCH /api/v1/consents/:id — revocation enqueues consent_revoked job', async () => {
    // TODO
  });

  it('PATCH /api/v1/consents/:id — cannot transition from REVOKED to any other status', async () => {
    // TODO: Verify terminal state enforcement
  });

  it('POST /api/v1/enrollments — returns 409 after consent revocation', async () => {
    // TODO: EC-01 — in-flight enrollment fails after revocation
  });
});
