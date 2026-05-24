// TODO: Implement — see docs/modules/export.md

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

import { AppModule } from 'src/app.module';

describe('Export Token (e2e)', () => {
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

  it('POST /api/v1/tokens — creates single-use export token with Redis jti', async () => {
    // TODO: Verify jti stored in Redis
  });

  it('GET /api/v1/patients/:id/summary — returns patient summary on valid token', async () => {
    // TODO: Verify audit log entry created
  });

  it('GET /api/v1/patients/:id/summary — returns 401 on second use of same token (EC-03)', async () => {
    // TODO: Verify getdel returns null on replay
  });

  it('GET /api/v1/patients/:id/summary — returns 401 on expired token', async () => {
    // TODO
  });
});
