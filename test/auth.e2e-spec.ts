// TODO: Implement — see docs/modules/auth.md

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

import { AppModule } from 'src/app.module';

describe('Auth (e2e)', () => {
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

  it('POST /api/v1/auth/register/patient — registers patient with atomic transaction', async () => {
    // TODO
  });

  it('POST /api/v1/auth/login — issues access token and refresh cookie', async () => {
    // TODO
  });

  it('POST /api/v1/auth/refresh — rotates tokens on valid refresh cookie', async () => {
    // TODO
  });

  it('POST /api/v1/auth/logout — revokes refresh token jti in Redis', async () => {
    // TODO
  });
});
