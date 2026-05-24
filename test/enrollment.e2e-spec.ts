// TODO: Implement — see docs/modules/enrollments.md

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

import { AppModule } from 'src/app.module';

describe('Enrollment (e2e)', () => {
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

  it('POST /api/v1/enrollments — creates enrollment with sharedDataSnapshot', async () => {
    // TODO: Verify sharedDataSnapshot contains only consented fields from SNAPSHOT_FIELDS
  });

  it('POST /api/v1/enrollments — returns 409 when no active consent exists', async () => {
    // TODO
  });

  it('POST /api/v1/enrollments — returns 409 on duplicate active enrollment', async () => {
    // TODO
  });
});
