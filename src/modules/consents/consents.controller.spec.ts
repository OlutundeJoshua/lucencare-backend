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

import { ConsentPurpose, ConsentStatus } from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';

import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { ConsentGrant } from './entities/consent-grant.entity';

const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZCTR';
const GRANT_ID = '01HZZZZZZZZZZZZZZZZZZZZZGRT';

const mockGrant: Partial<ConsentGrant> = {
  id: GRANT_ID,
  patientId: '01HZZZZZZZZZZZZZZZZZZZZZPT1',
  purpose: ConsentPurpose.NGO_FUNDING,
  dataScopes: SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING],
  status: ConsentStatus.ACTIVE,
  grantedAt: new Date(),
  version: 1,
};

const mockImpact = {
  affectedEnrollments: [],
  affectedStudyEnrollments: [],
  totalAffected: 0,
};

const mockConsentsService = {
  getMyConsents: jest.fn(),
  create: jest.fn(),
  transition: jest.fn(),
  getImpact: jest.fn(),
};

// Populates request.user so @CurrentUser() resolves correctly
const allowAllGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'patient', email: 'patient@test.com' };
    return true;
  },
};

const denyGuard = {
  canActivate: () => { throw new ForbiddenException(); },
};

async function buildApp(roleGuardOverride = allowAllGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [ConsentsController],
    providers: [{ provide: ConsentsService, useValue: mockConsentsService }],
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
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return app;
}

describe('ConsentsController', () => {
  let app: INestApplication;

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------
  // GET /consents/me
  // ---------------------------------------------------------------------------
  describe('GET /consents/me', () => {
    it('returns 200 with the list of consent grants', async () => {
      app = await buildApp();
      mockConsentsService.getMyConsents.mockResolvedValue([mockGrant]);

      await request(app.getHttpServer())
        .get('/consents/me')
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(1);
          expect(mockConsentsService.getMyConsents).toHaveBeenCalledWith(TEST_USER_ID);
        });
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      await request(app.getHttpServer())
        .get('/consents/me')
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /consents
  // ---------------------------------------------------------------------------
  describe('POST /consents', () => {
    const validBody = {
      purpose: ConsentPurpose.NGO_FUNDING,
      dataScopes: ['name', 'conditionTags'],
    };

    it('returns 201 with the created grant', async () => {
      app = await buildApp();
      mockConsentsService.create.mockResolvedValue(mockGrant);

      await request(app.getHttpServer())
        .post('/consents')
        .send(validBody)
        .expect(201)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
          expect(mockConsentsService.create).toHaveBeenCalledWith(TEST_USER_ID, expect.objectContaining(validBody));
        });
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      await request(app.getHttpServer())
        .post('/consents')
        .send(validBody)
        .expect(403);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockConsentsService.create.mockRejectedValue(new ConflictException('Already exists'));

      await request(app.getHttpServer())
        .post('/consents')
        .send(validBody)
        .expect(409);
    });

    it('returns 422 when purpose is missing', async () => {
      app = await buildApp();

      await request(app.getHttpServer())
        .post('/consents')
        .send({ dataScopes: ['name'] })
        .expect(422);
    });

    it('returns 422 when dataScopes is empty', async () => {
      app = await buildApp();

      await request(app.getHttpServer())
        .post('/consents')
        .send({ purpose: ConsentPurpose.NGO_FUNDING, dataScopes: [] })
        .expect(422);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /consents/:id
  // ---------------------------------------------------------------------------
  describe('PATCH /consents/:id', () => {
    const validBody = { status: ConsentStatus.PAUSED };

    it('returns 200 with the updated grant', async () => {
      app = await buildApp();
      const updated = { ...mockGrant, status: ConsentStatus.PAUSED };
      mockConsentsService.transition.mockResolvedValue(updated);

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send(validBody)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.status).toBe(ConsentStatus.PAUSED);
          expect(mockConsentsService.transition).toHaveBeenCalledWith(GRANT_ID, TEST_USER_ID, expect.objectContaining(validBody));
        });
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send(validBody)
        .expect(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockConsentsService.transition.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send(validBody)
        .expect(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockConsentsService.transition.mockRejectedValue(new ConflictException('Invalid transition'));

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send(validBody)
        .expect(409);
    });

    it('returns 422 when status is missing', async () => {
      app = await buildApp();

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send({})
        .expect(422);
    });

    it('returns 422 when status is not a valid enum value', async () => {
      app = await buildApp();

      await request(app.getHttpServer())
        .patch(`/consents/${GRANT_ID}`)
        .send({ status: 'invalid_status' })
        .expect(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /consents/:id/impact
  // ---------------------------------------------------------------------------
  describe('GET /consents/:id/impact', () => {
    it('returns 200 with the impact summary', async () => {
      app = await buildApp();
      mockConsentsService.getImpact.mockResolvedValue(mockImpact);

      await request(app.getHttpServer())
        .get(`/consents/${GRANT_ID}/impact`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.totalAffected).toBe(0);
          expect(mockConsentsService.getImpact).toHaveBeenCalledWith(GRANT_ID, TEST_USER_ID);
        });
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      await request(app.getHttpServer())
        .get(`/consents/${GRANT_ID}/impact`)
        .expect(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockConsentsService.getImpact.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer())
        .get(`/consents/${GRANT_ID}/impact`)
        .expect(404);
    });
  });
});
