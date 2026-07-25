import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';

import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

const TEST_PATIENT_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';

const mockPaginatedPrograms = { items: [{ id: '01HZZZZZZZZZZZZZZZZZZZZZAB', title: 'Test Program' }] };
const mockPaginatedStudies = { items: [{ id: '01HZZZZZZZZZZZZZZZZZZZZZAC', title: 'Test Study' }] };

const mockMatchingService = {
  findMatchingPrograms: jest.fn(),
  findStudies: jest.fn(),
};

// Populates request.user so @CurrentUser() resolves to a valid JWT payload
const allowAllGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_PATIENT_USER_ID, role: 'patient' };
    return true;
  },
};

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

async function buildApp(roleGuardOverride = allowAllGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [MatchingController],
    providers: [{ provide: MatchingService, useValue: mockMatchingService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(allowAllGuard)
    .overrideGuard(RoleGuard)
    .useValue(roleGuardOverride)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          errors: errors.map((e) => ({
            path: e.property,
            message: Object.values(e.constraints ?? {}).join('; '),
          })),
        }),
    }),
  );
  await app.init();
  return app;
}

describe('MatchingController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await buildApp();
    const controller = app.get(MatchingController);
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /recommendations/funding
  // ---------------------------------------------------------------------------

  describe('GET /recommendations/funding', () => {
    it('returns 200 with matching programs', async () => {
      app = await buildApp();
      mockMatchingService.findMatchingPrograms.mockResolvedValue(mockPaginatedPrograms);

      const res = await request(app.getHttpServer()).get('/recommendations/funding');

      expect(res.status).toBe(200);
      expect(mockMatchingService.findMatchingPrograms).toHaveBeenCalledWith(
        TEST_PATIENT_USER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/recommendations/funding');

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockMatchingService.findMatchingPrograms.mockRejectedValue(
        new NotFoundException('Patient profile not found'),
      );

      const res = await request(app.getHttpServer()).get('/recommendations/funding');

      expect(res.status).toBe(404);
    });

    it('returns 422 when limit is out of range', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/recommendations/funding').query({ limit: 100 });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /recommendations/studies
  // ---------------------------------------------------------------------------

  describe('GET /recommendations/studies', () => {
    it('returns 200 with matching studies', async () => {
      app = await buildApp();
      mockMatchingService.findStudies.mockResolvedValue(mockPaginatedStudies);

      const res = await request(app.getHttpServer()).get('/recommendations/studies');

      expect(res.status).toBe(200);
      expect(mockMatchingService.findStudies).toHaveBeenCalledWith(
        TEST_PATIENT_USER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/recommendations/studies');

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockMatchingService.findStudies.mockRejectedValue(new NotFoundException('Patient profile not found'));

      const res = await request(app.getHttpServer()).get('/recommendations/studies');

      expect(res.status).toBe(404);
    });
  });
});
