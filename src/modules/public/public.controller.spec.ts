import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';

import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';

import { PublicController } from './public.controller';
import { PublicService } from './public.service';

const mockPublicService = { getStats: jest.fn() };

describe('PublicController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [{ provide: PublicService, useValue: mockPublicService }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    // Constructed rather than resolved through DI, as community.controller.spec.ts
    // does: the interceptor's ClsService is optional, and pulling it in would drag
    // the whole CLS module into a test that only cares about the response shape.
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /public/stats', () => {
    // The reason this module exists: the landing page has no token to send.
    it('is reachable without an Authorization header', async () => {
      mockPublicService.getStats.mockResolvedValue({ patients: 12, ngoPrograms: 4 });

      const res = await request(app.getHttpServer()).get('/public/stats').expect(200);

      expect(res.body.data).toEqual({ patients: 12, ngoPrograms: 4 });
    });

    it('wraps the totals in the standard response envelope', async () => {
      mockPublicService.getStats.mockResolvedValue({ patients: 12, ngoPrograms: 4 });

      const res = await request(app.getHttpServer()).get('/public/stats').expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('traceId');
    });

    it('returns zeroes rather than failing on an empty platform', async () => {
      mockPublicService.getStats.mockResolvedValue({ patients: 0, ngoPrograms: 0 });

      const res = await request(app.getHttpServer()).get('/public/stats').expect(200);

      expect(res.body.data).toEqual({ patients: 0, ngoPrograms: 0 });
    });
  });
});
