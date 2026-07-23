import {
  ConflictException,
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

import { EnrollmentsController, StudyEnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

const TEST_PATIENT_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';

const mockEnrollment = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZAB',
  programId: '01HZZZZZZZZZZZZZZZZZZZZZAC',
  status: 'active',
};

const mockStudyEnrollment = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZAD',
  studyId: '01HZZZZZZZZZZZZZZZZZZZZZAE',
  status: 'interested',
};

const mockEnrollmentsService = {
  listMyEnrollments: jest.fn(),
  createEnrollment: jest.fn(),
  getEnrollment: jest.fn(),
  listMyStudyEnrollments: jest.fn(),
  createStudyEnrollment: jest.fn(),
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
    controllers: [EnrollmentsController, StudyEnrollmentsController],
    providers: [{ provide: EnrollmentsService, useValue: mockEnrollmentsService }],
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

describe('EnrollmentsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await buildApp();
    const controller = app.get(EnrollmentsController);
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /enrollments
  // ---------------------------------------------------------------------------

  describe('GET /enrollments', () => {
    it('returns 200 with the caller enrollments', async () => {
      app = await buildApp();
      mockEnrollmentsService.listMyEnrollments.mockResolvedValue({ enrollments: [mockEnrollment] });

      const res = await request(app.getHttpServer()).get('/enrollments');

      expect(res.status).toBe(200);
      expect(mockEnrollmentsService.listMyEnrollments).toHaveBeenCalledWith(
        TEST_PATIENT_USER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/enrollments');

      expect(res.status).toBe(403);
    });

    it('returns 422 when limit is out of range', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/enrollments').query({ limit: 100 });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /enrollments
  // ---------------------------------------------------------------------------

  describe('POST /enrollments', () => {
    const validBody = { programId: '01HZZZZZZZZZZZZZZZZZZZZZAC' };

    it('returns 201 with the created enrollment', async () => {
      app = await buildApp();
      mockEnrollmentsService.createEnrollment.mockResolvedValue(mockEnrollment);

      const res = await request(app.getHttpServer()).post('/enrollments').send(validBody);

      expect(res.status).toBe(201);
      expect(mockEnrollmentsService.createEnrollment).toHaveBeenCalledWith(TEST_PATIENT_USER_ID, validBody);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post('/enrollments').send(validBody);

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockEnrollmentsService.createEnrollment.mockRejectedValue(new NotFoundException('Program not found'));

      const res = await request(app.getHttpServer()).post('/enrollments').send(validBody);

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockEnrollmentsService.createEnrollment.mockRejectedValue(
        new ConflictException('Patient is already actively enrolled in this program'),
      );

      const res = await request(app.getHttpServer()).post('/enrollments').send(validBody);

      expect(res.status).toBe(409);
    });

    it('returns 422 when programId is missing', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).post('/enrollments').send({});

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /enrollments/:id
  // ---------------------------------------------------------------------------

  describe('GET /enrollments/:id', () => {
    it('returns 200 with the enrollment', async () => {
      app = await buildApp();
      mockEnrollmentsService.getEnrollment.mockResolvedValue(mockEnrollment);

      const res = await request(app.getHttpServer()).get(`/enrollments/${mockEnrollment.id}`);

      expect(res.status).toBe(200);
      expect(mockEnrollmentsService.getEnrollment).toHaveBeenCalledWith(mockEnrollment.id, TEST_PATIENT_USER_ID);
    });

    it('returns 403 when service throws ForbiddenException (not the owner)', async () => {
      app = await buildApp();
      mockEnrollmentsService.getEnrollment.mockRejectedValue(
        new ForbiddenException('Access denied: this enrollment does not belong to you'),
      );

      const res = await request(app.getHttpServer()).get(`/enrollments/${mockEnrollment.id}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockEnrollmentsService.getEnrollment.mockRejectedValue(new NotFoundException('Enrollment not found'));

      const res = await request(app.getHttpServer()).get(`/enrollments/${mockEnrollment.id}`);

      expect(res.status).toBe(404);
    });
  });
});

describe('StudyEnrollmentsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await buildApp();
    const controller = app.get(StudyEnrollmentsController);
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /study-enrollments
  // ---------------------------------------------------------------------------

  describe('GET /study-enrollments', () => {
    it('returns 200 with the caller study enrollments', async () => {
      app = await buildApp();
      mockEnrollmentsService.listMyStudyEnrollments.mockResolvedValue({
        studyEnrollments: [mockStudyEnrollment],
      });

      const res = await request(app.getHttpServer()).get('/study-enrollments');

      expect(res.status).toBe(200);
      expect(mockEnrollmentsService.listMyStudyEnrollments).toHaveBeenCalledWith(
        TEST_PATIENT_USER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/study-enrollments');

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /study-enrollments
  // ---------------------------------------------------------------------------

  describe('POST /study-enrollments', () => {
    const validBody = { studyId: '01HZZZZZZZZZZZZZZZZZZZZZAE' };

    it('returns 201 with the created study enrollment', async () => {
      app = await buildApp();
      mockEnrollmentsService.createStudyEnrollment.mockResolvedValue(mockStudyEnrollment);

      const res = await request(app.getHttpServer()).post('/study-enrollments').send(validBody);

      expect(res.status).toBe(201);
      expect(mockEnrollmentsService.createStudyEnrollment).toHaveBeenCalledWith(
        TEST_PATIENT_USER_ID,
        expect.objectContaining({ studyId: validBody.studyId }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post('/study-enrollments').send(validBody);

      expect(res.status).toBe(403);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockEnrollmentsService.createStudyEnrollment.mockRejectedValue(
        new ConflictException('Patient already has an active interest or enrollment in this study'),
      );

      const res = await request(app.getHttpServer()).post('/study-enrollments').send(validBody);

      expect(res.status).toBe(409);
    });

    it('returns 422 when studyId is missing', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).post('/study-enrollments').send({});

      expect(res.status).toBe(422);
    });
  });
});
