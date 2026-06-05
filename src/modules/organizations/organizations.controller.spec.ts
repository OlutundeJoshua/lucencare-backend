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

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

const TEST_ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZAB';
const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';
const TEST_ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZZZAC';

const mockOrg = {
  id: TEST_ORG_ID,
  name: 'Test Org',
  type: 'ngo',
  status: 'active',
  contactEmail: 'org@test.com',
  createdAt: new Date().toISOString(),
};

const mockOrgsService = {
  findOne: jest.fn(),
  findAll: jest.fn(),
};

// Sets req.user as ngo_admin (org-scoped route caller)
const orgAdminGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'ngo_admin', orgId: TEST_ORG_ID };
    return true;
  },
};

// Sets req.user as platform_admin (list endpoint caller)
const platformAdminGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_ADMIN_ID, role: 'platform_admin' };
    return true;
  },
};

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

async function buildApp(roleGuardOverride = orgAdminGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [OrganizationsController],
    providers: [{ provide: OrganizationsService, useValue: mockOrgsService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(orgAdminGuard)
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

async function buildAdminApp(roleGuardOverride = platformAdminGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [OrganizationsController],
    providers: [{ provide: OrganizationsService, useValue: mockOrgsService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(platformAdminGuard)
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

describe('OrganizationsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await buildApp();
    const controller = app.get(OrganizationsController);
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /organizations/:id
  // ---------------------------------------------------------------------------

  describe('GET /organizations/:id', () => {
    it('returns 200 with org data on success', async () => {
      app = await buildApp();
      mockOrgsService.findOne.mockResolvedValue(mockOrg);

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}`);

      expect(res.status).toBe(200);
      expect(mockOrgsService.findOne).toHaveBeenCalledWith(TEST_ORG_ID, TEST_ORG_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}`);

      expect(res.status).toBe(403);
    });

    it('returns 403 when service throws ForbiddenException (cross-org or suspended)', async () => {
      app = await buildApp();
      mockOrgsService.findOne.mockRejectedValue(new ForbiddenException('Access denied: cross-org attempt'));

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockOrgsService.findOne.mockRejectedValue(new NotFoundException(`Organization ${TEST_ORG_ID} not found`));

      const res = await request(app.getHttpServer()).get(`/organizations/${TEST_ORG_ID}`);

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /organizations
  // ---------------------------------------------------------------------------

  describe('GET /organizations', () => {
    it('returns 200 with paginated org list', async () => {
      app = await buildAdminApp();
      mockOrgsService.findAll.mockResolvedValue({ orgs: [mockOrg], nextCursor: undefined });

      const res = await request(app.getHttpServer()).get('/organizations');

      expect(res.status).toBe(200);
      expect(mockOrgsService.findAll).toHaveBeenCalled();
    });

    it('returns 200 with nextCursor in meta when more pages exist', async () => {
      app = await buildAdminApp();
      mockOrgsService.findAll.mockResolvedValue({ orgs: [mockOrg], nextCursor: TEST_ORG_ID });

      const res = await request(app.getHttpServer()).get('/organizations?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.meta.cursor).toBe(TEST_ORG_ID);
    });

    it('returns 200 with status filter applied', async () => {
      app = await buildAdminApp();
      mockOrgsService.findAll.mockResolvedValue({ orgs: [], nextCursor: undefined });

      const res = await request(app.getHttpServer()).get('/organizations?status=pending_verification');

      expect(res.status).toBe(200);
      expect(mockOrgsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_verification' }),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildAdminApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/organizations');

      expect(res.status).toBe(403);
    });

    it('returns 422 when limit is out of range', async () => {
      app = await buildAdminApp();

      const res = await request(app.getHttpServer()).get('/organizations?limit=100');

      expect(res.status).toBe(422);
    });
  });
});
