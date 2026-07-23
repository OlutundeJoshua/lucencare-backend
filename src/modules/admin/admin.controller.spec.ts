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
import { ApplicationsService } from 'src/modules/applications/applications.service';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

const TEST_ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';

const mockOrg = { id: '01HZZZZZZZZZZZZZZZZZZZZZAB', name: 'Test Org', status: 'active' };
const mockProgram = { id: '01HZZZZZZZZZZZZZZZZZZZZZAD', title: 'Test Program', status: 'approved' };
const mockStudy = { id: '01HZZZZZZZZZZZZZZZZZZZZZAF', title: 'Test Study', status: 'approved' };
const mockProfessionalApplication = { id: '01HZZZZZZZZZZZZZZZZZZZZZAH', status: 'approved' };
const mockBenefactorApplication = { id: '01HZZZZZZZZZZZZZZZZZZZZZAJ', status: 'approved' };

const mockAdminService = {
  reviewOrganization: jest.fn(),
  reviewProgram: jest.fn(),
  reviewStudy: jest.fn(),
};

const mockApplicationsService = {
  findAllProfessional: jest.fn(),
  reviewProfessional: jest.fn(),
  findAllBenefactor: jest.fn(),
  reviewBenefactor: jest.fn(),
};

// Populates request.user so @CurrentUser() resolves to a valid JWT payload
const allowAllGuard = {
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

async function buildApp(roleGuardOverride = allowAllGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [
      { provide: AdminService, useValue: mockAdminService },
      { provide: ApplicationsService, useValue: mockApplicationsService },
    ],
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

describe('AdminController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await buildApp();
    const controller = app.get(AdminController);
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/organizations/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/organizations/:id', () => {
    it('returns 200 with updated organization on approval', async () => {
      app = await buildApp();
      mockAdminService.reviewOrganization.mockResolvedValue(mockOrg);

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'approved' });

      expect(res.status).toBe(200);
      expect(mockAdminService.reviewOrganization).toHaveBeenCalledWith(
        '01HZZZZZZZZZZZZZZZZZZZZZAB',
        TEST_ADMIN_ID,
        { status: 'approved' },
      );
    });

    it('returns 200 with updated organization on rejection with reason', async () => {
      app = await buildApp();
      mockAdminService.reviewOrganization.mockResolvedValue(mockOrg);

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'rejected', reason: 'Documents missing' });

      expect(res.status).toBe(200);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockAdminService.reviewOrganization.mockRejectedValue(new NotFoundException('Org not found'));

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockAdminService.reviewOrganization.mockRejectedValue(
        new ConflictException('Organization is not in a reviewable state'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'approved' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when status field is missing', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({});

      expect(res.status).toBe(422);
    });

    it('returns 422 when status=rejected but reason is absent', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/organizations/01HZZZZZZZZZZZZZZZZZZZZZAB')
        .send({ status: 'rejected' });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/programs/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/programs/:id', () => {
    it('returns 200 with updated program on approval', async () => {
      app = await buildApp();
      mockAdminService.reviewProgram.mockResolvedValue(mockProgram);

      const res = await request(app.getHttpServer())
        .patch('/admin/programs/01HZZZZZZZZZZZZZZZZZZZZZAD')
        .send({ status: 'approved' });

      expect(res.status).toBe(200);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer())
        .patch('/admin/programs/01HZZZZZZZZZZZZZZZZZZZZZAD')
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockAdminService.reviewProgram.mockRejectedValue(new NotFoundException('Program not found'));

      const res = await request(app.getHttpServer())
        .patch('/admin/programs/01HZZZZZZZZZZZZZZZZZZZZZAD')
        .send({ status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockAdminService.reviewProgram.mockRejectedValue(
        new ConflictException('Program is not in a reviewable state'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/programs/01HZZZZZZZZZZZZZZZZZZZZZAD')
        .send({ status: 'approved' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when status=rejected but reason is absent', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/programs/01HZZZZZZZZZZZZZZZZZZZZZAD')
        .send({ status: 'rejected' });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/studies/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/studies/:id', () => {
    it('returns 200 with updated study on approval', async () => {
      app = await buildApp();
      mockAdminService.reviewStudy.mockResolvedValue(mockStudy);

      const res = await request(app.getHttpServer())
        .patch('/admin/studies/01HZZZZZZZZZZZZZZZZZZZZZAF')
        .send({ status: 'approved' });

      expect(res.status).toBe(200);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer())
        .patch('/admin/studies/01HZZZZZZZZZZZZZZZZZZZZZAF')
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockAdminService.reviewStudy.mockRejectedValue(new NotFoundException('Study not found'));

      const res = await request(app.getHttpServer())
        .patch('/admin/studies/01HZZZZZZZZZZZZZZZZZZZZZAF')
        .send({ status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockAdminService.reviewStudy.mockRejectedValue(
        new ConflictException('Study is not in a reviewable state'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/studies/01HZZZZZZZZZZZZZZZZZZZZZAF')
        .send({ status: 'approved' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when status=rejected but reason is absent', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/studies/01HZZZZZZZZZZZZZZZZZZZZZAF')
        .send({ status: 'rejected' });

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/applications/professional
  // ---------------------------------------------------------------------------

  describe('GET /admin/applications/professional', () => {
    it('returns 200 with the list of applications', async () => {
      app = await buildApp();
      mockApplicationsService.findAllProfessional.mockResolvedValue([mockProfessionalApplication]);

      const res = await request(app.getHttpServer()).get('/admin/applications/professional');

      expect(res.status).toBe(200);
      expect(mockApplicationsService.findAllProfessional).toHaveBeenCalledWith(undefined);
    });

    it('passes the status filter through to the service', async () => {
      app = await buildApp();
      mockApplicationsService.findAllProfessional.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/admin/applications/professional')
        .query({ status: 'pending' });

      expect(res.status).toBe(200);
      expect(mockApplicationsService.findAllProfessional).toHaveBeenCalledWith('pending');
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/admin/applications/professional');

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/applications/professional/:id/review
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/applications/professional/:id/review', () => {
    it('returns 200 with the reviewed application on approval', async () => {
      app = await buildApp();
      mockApplicationsService.reviewProfessional.mockResolvedValue(mockProfessionalApplication);

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/professional/01HZZZZZZZZZZZZZZZZZZZZZAH/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
      expect(mockApplicationsService.reviewProfessional).toHaveBeenCalledWith(
        '01HZZZZZZZZZZZZZZZZZZZZZAH',
        TEST_ADMIN_ID,
        { action: 'approve' },
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/professional/01HZZZZZZZZZZZZZZZZZZZZZAH/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockApplicationsService.reviewProfessional.mockRejectedValue(
        new NotFoundException('Professional application not found'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/professional/01HZZZZZZZZZZZZZZZZZZZZZAH/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockApplicationsService.reviewProfessional.mockRejectedValue(
        new ConflictException('Application is not in a reviewable state'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/professional/01HZZZZZZZZZZZZZZZZZZZZZAH/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when action is missing', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/professional/01HZZZZZZZZZZZZZZZZZZZZZAH/review')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/applications/benefactor
  // ---------------------------------------------------------------------------

  describe('GET /admin/applications/benefactor', () => {
    it('returns 200 with the list of applications', async () => {
      app = await buildApp();
      mockApplicationsService.findAllBenefactor.mockResolvedValue([mockBenefactorApplication]);

      const res = await request(app.getHttpServer()).get('/admin/applications/benefactor');

      expect(res.status).toBe(200);
      expect(mockApplicationsService.findAllBenefactor).toHaveBeenCalledWith(undefined);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer()).get('/admin/applications/benefactor');

      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /admin/applications/benefactor/:id/review
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/applications/benefactor/:id/review', () => {
    it('returns 200 with the reviewed application on approval', async () => {
      app = await buildApp();
      mockApplicationsService.reviewBenefactor.mockResolvedValue(mockBenefactorApplication);

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/benefactor/01HZZZZZZZZZZZZZZZZZZZZZAJ/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
      expect(mockApplicationsService.reviewBenefactor).toHaveBeenCalledWith(
        '01HZZZZZZZZZZZZZZZZZZZZZAJ',
        TEST_ADMIN_ID,
        { action: 'approve' },
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/benefactor/01HZZZZZZZZZZZZZZZZZZZZZAJ/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockApplicationsService.reviewBenefactor.mockRejectedValue(
        new NotFoundException('Benefactor application not found'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/benefactor/01HZZZZZZZZZZZZZZZZZZZZZAJ/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await buildApp();
      mockApplicationsService.reviewBenefactor.mockRejectedValue(
        new ConflictException('Application is not in a reviewable state'),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/benefactor/01HZZZZZZZZZZZZZZZZZZZZZAJ/review')
        .send({ action: 'approve' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when action is invalid', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch('/admin/applications/benefactor/01HZZZZZZZZZZZZZZZZZZZZZAJ/review')
        .send({ action: 'maybe' });

      expect(res.status).toBe(422);
    });
  });
});
