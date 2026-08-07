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
import { ProgramStatus, ProgramType } from 'src/common/enums';
import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';

import { OrgProgramsController, ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

const TEST_ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZORG';
const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZUSR';
const TEST_PROGRAM_ID = '01HZZZZZZZZZZZZZZZZZZZZPGM';

const mockProgram = {
  id: TEST_PROGRAM_ID,
  orgId: TEST_ORG_ID,
  title: 'Test Program',
  type: ProgramType.NGO_FUNDING,
  status: ProgramStatus.PENDING_REVIEW,
  eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const mockProgramsService = {
  create: jest.fn(),
  findByOrg: jest.fn(),
  findByIdForOrg: jest.fn(),
  getMatchPreview: jest.fn(),
  getOrgStats: jest.fn(),
  getPatientMap: jest.fn(),
  getEnrollments: jest.fn(),
  triggerFanOut: jest.fn(),
  updateStatus: jest.fn(),
};

const ngoAdminGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'ngo_admin', orgId: TEST_ORG_ID };
    return true;
  },
};

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

async function buildApp(roleGuardOverride = ngoAdminGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [ProgramsController, OrgProgramsController],
    providers: [{ provide: ProgramsService, useValue: mockProgramsService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(ngoAdminGuard)
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
  // Registered so these tests see the real wire shape. Without it the spec asserted
  // the controller's raw return, which is exactly how three handlers shipped
  // double-wrapped as { data: { data } } without a single test noticing.
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return app;
}

describe('ProgramsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------
  // POST /programs
  // ---------------------------------------------------------------------------

  describe('POST /programs', () => {
    const validBody = {
      title: 'Test Program',
      type: ProgramType.NGO_FUNDING,
      eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it('returns 201 on success', async () => {
      app = await buildApp();
      mockProgramsService.create.mockResolvedValue(mockProgram);

      const res = await request(app.getHttpServer()).post('/programs').send(validBody);

      expect(res.status).toBe(201);
      expect(mockProgramsService.create).toHaveBeenCalledWith(
        TEST_ORG_ID,
        expect.objectContaining({ title: validBody.title }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post('/programs').send(validBody);

      expect(res.status).toBe(403);
    });

    it('returns 403 when service throws ForbiddenException (org not active)', async () => {
      app = await buildApp();
      mockProgramsService.create.mockRejectedValue(
        new ForbiddenException('Organization must be active'),
      );

      const res = await request(app.getHttpServer()).post('/programs').send(validBody);

      expect(res.status).toBe(403);
    });

    it('returns 422 when title is missing', async () => {
      app = await buildApp();
      const { title: _t, ...bodyWithoutTitle } = validBody;

      const res = await request(app.getHttpServer()).post('/programs').send(bodyWithoutTitle);

      expect(res.status).toBe(422);
    });

    it('returns 422 when eligibilityCriteria is empty', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post('/programs')
        .send({ ...validBody, eligibilityCriteria: [] });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /organizations/:orgId/programs
  // ---------------------------------------------------------------------------

  describe('GET /organizations/:orgId/programs', () => {
    it('returns 200 with paginated programs', async () => {
      app = await buildApp();
      mockProgramsService.findByOrg.mockResolvedValue({
        programs: [mockProgram],
        nextCursor: undefined,
      });

      const res = await request(app.getHttpServer()).get(
        `/organizations/${TEST_ORG_ID}/programs`,
      );

      expect(res.status).toBe(200);
      expect(mockProgramsService.findByOrg).toHaveBeenCalledWith(
        TEST_ORG_ID,
        expect.any(Object),
      );
    });

    it('returns 200 with nextCursor in meta when more pages exist', async () => {
      app = await buildApp();
      mockProgramsService.findByOrg.mockResolvedValue({
        programs: [mockProgram],
        nextCursor: TEST_PROGRAM_ID,
      });

      const res = await request(app.getHttpServer()).get(
        `/organizations/${TEST_ORG_ID}/programs`,
      );

      expect(res.status).toBe(200);
      expect(res.body.meta.cursor).toBe(TEST_PROGRAM_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/organizations/${TEST_ORG_ID}/programs`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 403 when orgId in path does not match user orgId', async () => {
      app = await buildApp();
      // req.user.orgId = TEST_ORG_ID, but we request a different org
      const res = await request(app.getHttpServer()).get(
        `/organizations/DIFFERENT_ORG_ZZZZZZZZZ/programs`,
      );

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /organizations/:orgId/stats
  // ---------------------------------------------------------------------------

  describe('GET /organizations/:orgId/stats', () => {
    const stats = {
      activePrograms: 2,
      totalPrograms: 4,
      totalApplicants: 31,
      pendingReview: 7,
      selectedPatients: 18,
      waitlisted: 4,
      rejected: 2,
      budgetTotal: 1_850_000_000,
      budgetDisbursed: 1_120_000_000,
      slotsTotal: 90,
      slotsFilled: 52,
    };

    it('returns 200 with the dashboard aggregates, wrapped once', async () => {
      app = await buildApp();
      mockProgramsService.getOrgStats.mockResolvedValue(stats);

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}/stats`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(stats);
      expect(res.body.data).not.toHaveProperty('data');
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}/stats`);

      expect(res.status).toBe(403);
      expect(mockProgramsService.getOrgStats).not.toHaveBeenCalled();
    });

    it('returns 403 for another organisation’s stats', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).get(
        `/organizations/DIFFERENT_ORG_ZZZZZZZZZ/stats`,
      );

      expect(res.status).toBe(403);
      expect(mockProgramsService.getOrgStats).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // GET /organizations/:orgId/patient-map
  // ---------------------------------------------------------------------------

  describe('GET /organizations/:orgId/patient-map', () => {
    const mapRows = [
      { state: 'Lagos', selected: 8, inReview: 3, waitlisted: 1, total: 12, topCondition: 'Hypertension' },
      { state: 'Unspecified', selected: 1, inReview: 2, waitlisted: 0, total: 3 },
    ];

    it('returns 200 with aggregates and no patient-level fields', async () => {
      app = await buildApp();
      mockProgramsService.getPatientMap.mockResolvedValue(mapRows);

      const res = await request(app.getHttpServer()).get(
        `/organizations/${TEST_ORG_ID}/patient-map`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mapRows);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('patientId');
      expect(body).not.toContain('sharedDataSnapshot');
    });

    it('returns 403 for another organisation’s map', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer()).get(
        `/organizations/DIFFERENT_ORG_ZZZZZZZZZ/patient-map`,
      );

      expect(res.status).toBe(403);
      expect(mockProgramsService.getPatientMap).not.toHaveBeenCalled();
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/organizations/${TEST_ORG_ID}/patient-map`,
      );

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /programs/:id/matches
  // ---------------------------------------------------------------------------

  describe('GET /programs/:id/matches', () => {
    it('returns 200 with aggregate match preview', async () => {
      app = await buildApp();
      const preview = { eligibleCount: 50, tagSummary: { diabetes: 50 } };
      mockProgramsService.getMatchPreview.mockResolvedValue(preview);

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/matches`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(preview);
      expect(res.body.data).not.toHaveProperty('patientIds');
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/matches`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockProgramsService.getMatchPreview.mockRejectedValue(
        new NotFoundException(`Program ${TEST_PROGRAM_ID} not found`),
      );

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/matches`,
      );

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /programs/:id/enrollments
  // ---------------------------------------------------------------------------

  describe('GET /programs/:id/enrollments', () => {
    const enrollment = {
      id: '01HZZZZZZZZZZZZZZZZZZZZENR',
      status: 'active',
      sharedDataSnapshot: { conditionTags: ['diabetes'] },
      createdAt: new Date().toISOString(),
    };

    it('returns 200 with enrollment snapshots', async () => {
      app = await buildApp();
      mockProgramsService.getEnrollments.mockResolvedValue({
        enrollments: [enrollment],
        nextCursor: undefined,
      });

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns pagination meta with cursor', async () => {
      app = await buildApp();
      const cursor = '01HZZZZZZZZZZZZZZZZZZZZENR';
      mockProgramsService.getEnrollments.mockResolvedValue({
        enrollments: [enrollment],
        nextCursor: cursor,
      });

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.meta.cursor).toBe(cursor);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/enrollments`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockProgramsService.getEnrollments.mockRejectedValue(
        new NotFoundException(`Program ${TEST_PROGRAM_ID} not found`),
      );

      const res = await request(app.getHttpServer()).get(
        `/programs/${TEST_PROGRAM_ID}/enrollments`,
      );

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /programs/:id/notify
  // ---------------------------------------------------------------------------

  describe('POST /programs/:id/notify', () => {
    it('returns 202 with queued message on success', async () => {
      app = await buildApp();
      mockProgramsService.triggerFanOut.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer()).post(
        `/programs/${TEST_PROGRAM_ID}/notify`,
      );

      expect(res.status).toBe(202);
      expect(res.body.data.message).toBe('Notification job queued');
      // Guards the double-wrap regression: the payload must not be nested twice.
      expect(res.body.data).not.toHaveProperty('data');
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).post(
        `/programs/${TEST_PROGRAM_ID}/notify`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 409 when program is not approved', async () => {
      app = await buildApp();
      mockProgramsService.triggerFanOut.mockRejectedValue(
        new ConflictException('Program must be approved'),
      );

      const res = await request(app.getHttpServer()).post(
        `/programs/${TEST_PROGRAM_ID}/notify`,
      );

      expect(res.status).toBe(409);
    });

    it('returns 404 when program not found', async () => {
      app = await buildApp();
      mockProgramsService.triggerFanOut.mockRejectedValue(
        new NotFoundException(`Program ${TEST_PROGRAM_ID} not found`),
      );

      const res = await request(app.getHttpServer()).post(
        `/programs/${TEST_PROGRAM_ID}/notify`,
      );

      expect(res.status).toBe(404);
    });
  });
});
