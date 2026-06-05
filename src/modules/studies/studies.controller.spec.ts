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
import { StudyEnrollmentStatus, StudyStatus } from 'src/common/enums';

import {
  ResearcherStudiesController,
  StudiesController,
  StudyEnrollmentsController,
} from './studies.controller';
import { StudiesService } from './studies.service';

const TEST_RESEARCHER_ID = '01HZZZZZZZZZZZZZZZZZZZRSCH';
const TEST_STUDY_ID = '01HZZZZZZZZZZZZZZZZZZZSTUDY';
const TEST_ENROLLMENT_ID = '01HZZZZZZZZZZZZZZZZZZZZENR';

const mockStudy = {
  id: TEST_STUDY_ID,
  researcherId: TEST_RESEARCHER_ID,
  title: 'Test Study',
  irbNumber: 'IRB-2024-0042',
  status: StudyStatus.PENDING_REVIEW,
  eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }],
  infoSheetUrl: 'https://s3.example.com/info.pdf',
  targetCount: 100,
  createdAt: new Date().toISOString(),
};

const mockStudiesService = {
  create: jest.fn(),
  findByResearcher: jest.fn(),
  findByIdForResearcher: jest.fn(),
  getEnrollments: jest.fn(),
  inviteParticipant: jest.fn(),
  updateStatus: jest.fn(),
};

const researcherGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_RESEARCHER_ID, role: 'researcher' };
    return true;
  },
};

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

async function buildApp(roleGuardOverride = researcherGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [StudiesController, ResearcherStudiesController, StudyEnrollmentsController],
    providers: [{ provide: StudiesService, useValue: mockStudiesService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(researcherGuard)
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

describe('StudiesController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------
  // POST /studies
  // ---------------------------------------------------------------------------

  describe('POST /studies', () => {
    const validBody = {
      title: 'Test Study',
      irbNumber: 'IRB-2024-0042',
      eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }],
      infoSheetUrl: 'https://s3.example.com/info.pdf',
      targetCount: 100,
    };

    it('returns 201 on success', async () => {
      app = await buildApp();
      mockStudiesService.create.mockResolvedValue(mockStudy);

      const res = await request(app.getHttpServer()).post('/studies').send(validBody);

      expect(res.status).toBe(201);
      expect(mockStudiesService.create).toHaveBeenCalledWith(
        TEST_RESEARCHER_ID,
        expect.objectContaining({ title: validBody.title, irbNumber: validBody.irbNumber }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post('/studies').send(validBody);

      expect(res.status).toBe(403);
    });

    it('returns 409 when service throws ConflictException (duplicate IRB)', async () => {
      app = await buildApp();
      mockStudiesService.create.mockRejectedValue(
        new ConflictException('IRB number already exists'),
      );

      const res = await request(app.getHttpServer()).post('/studies').send(validBody);

      expect(res.status).toBe(409);
    });

    it('returns 422 when IRB number format is invalid', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post('/studies')
        .send({ ...validBody, irbNumber: 'BAD-FORMAT' });

      expect(res.status).toBe(422);
    });

    it('returns 422 when infoSheetUrl is not a valid URL', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post('/studies')
        .send({ ...validBody, infoSheetUrl: 'not-a-url' });

      expect(res.status).toBe(422);
    });

    it('returns 422 when eligibilityCriteria is empty', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post('/studies')
        .send({ ...validBody, eligibilityCriteria: [] });

      expect(res.status).toBe(422);
    });

    it('returns 422 when title is missing', async () => {
      app = await buildApp();
      const { title: _t, ...bodyWithoutTitle } = validBody;

      const res = await request(app.getHttpServer()).post('/studies').send(bodyWithoutTitle);

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /researchers/:researcherId/studies
  // ---------------------------------------------------------------------------

  describe('GET /researchers/:researcherId/studies', () => {
    it('returns 200 with paginated studies', async () => {
      app = await buildApp();
      mockStudiesService.findByResearcher.mockResolvedValue({
        studies: [mockStudy],
        nextCursor: undefined,
      });

      const res = await request(app.getHttpServer()).get(
        `/researchers/${TEST_RESEARCHER_ID}/studies`,
      );

      expect(res.status).toBe(200);
      expect(mockStudiesService.findByResearcher).toHaveBeenCalledWith(
        TEST_RESEARCHER_ID,
        TEST_RESEARCHER_ID,
        expect.any(Object),
      );
    });

    it('returns 200 with nextCursor in meta when more pages exist', async () => {
      app = await buildApp();
      mockStudiesService.findByResearcher.mockResolvedValue({
        studies: [mockStudy],
        nextCursor: TEST_STUDY_ID,
      });

      const res = await request(app.getHttpServer()).get(
        `/researchers/${TEST_RESEARCHER_ID}/studies`,
      );

      expect(res.status).toBe(200);
      expect(res.body.meta.cursor).toBe(TEST_STUDY_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/researchers/${TEST_RESEARCHER_ID}/studies`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 403 when service throws ForbiddenException (wrong researcher)', async () => {
      app = await buildApp();
      mockStudiesService.findByResearcher.mockRejectedValue(new ForbiddenException());

      const res = await request(app.getHttpServer()).get(
        `/researchers/${TEST_RESEARCHER_ID}/studies`,
      );

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /studies/:id/enrollments
  // ---------------------------------------------------------------------------

  describe('GET /studies/:id/enrollments', () => {
    const enrollment = {
      id: TEST_ENROLLMENT_ID,
      studyId: TEST_STUDY_ID,
      status: StudyEnrollmentStatus.INTERESTED,
      sharedDataSnapshot: { conditionTags: ['diabetes'] },
      directContactShared: false,
      createdAt: new Date().toISOString(),
    };

    it('returns 200 with enrollment list', async () => {
      app = await buildApp();
      mockStudiesService.getEnrollments.mockResolvedValue({
        enrollments: [enrollment],
        nextCursor: undefined,
      });

      const res = await request(app.getHttpServer()).get(
        `/studies/${TEST_STUDY_ID}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/studies/${TEST_STUDY_ID}/enrollments`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockStudiesService.getEnrollments.mockRejectedValue(
        new NotFoundException(`Study ${TEST_STUDY_ID} not found`),
      );

      const res = await request(app.getHttpServer()).get(
        `/studies/${TEST_STUDY_ID}/enrollments`,
      );

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /study-enrollments/:id/invite
  // ---------------------------------------------------------------------------

  describe('POST /study-enrollments/:id/invite', () => {
    const updatedEnrollment = {
      id: TEST_ENROLLMENT_ID,
      studyId: TEST_STUDY_ID,
      status: StudyEnrollmentStatus.SCREENED,
      sharedDataSnapshot: {},
      directContactShared: false,
      createdAt: new Date().toISOString(),
    };

    it('returns 201 on successful status advance', async () => {
      app = await buildApp();
      mockStudiesService.inviteParticipant.mockResolvedValue(updatedEnrollment);

      const res = await request(app.getHttpServer()).post(
        `/study-enrollments/${TEST_ENROLLMENT_ID}/invite`,
      );

      expect(res.status).toBe(201);
      expect(mockStudiesService.inviteParticipant).toHaveBeenCalledWith(
        TEST_ENROLLMENT_ID,
        TEST_RESEARCHER_ID,
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post(
        `/study-enrollments/${TEST_ENROLLMENT_ID}/invite`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 409 when service throws ConflictException (invalid transition)', async () => {
      app = await buildApp();
      mockStudiesService.inviteParticipant.mockRejectedValue(
        new ConflictException('Invalid status transition'),
      );

      const res = await request(app.getHttpServer()).post(
        `/study-enrollments/${TEST_ENROLLMENT_ID}/invite`,
      );

      expect(res.status).toBe(409);
    });

    it('returns 404 when enrollment not found', async () => {
      app = await buildApp();
      mockStudiesService.inviteParticipant.mockRejectedValue(
        new NotFoundException(`Study enrollment ${TEST_ENROLLMENT_ID} not found`),
      );

      const res = await request(app.getHttpServer()).post(
        `/study-enrollments/${TEST_ENROLLMENT_ID}/invite`,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when service throws ForbiddenException (wrong researcher)', async () => {
      app = await buildApp();
      mockStudiesService.inviteParticipant.mockRejectedValue(new ForbiddenException());

      const res = await request(app.getHttpServer()).post(
        `/study-enrollments/${TEST_ENROLLMENT_ID}/invite`,
      );

      expect(res.status).toBe(403);
    });
  });
});
