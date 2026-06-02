import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { CareEventType, HmoLinkRequestStatus, UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

// ─── Constants ───────────────────────────────────────────────────────────────

const PATIENT_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZA1';
const COORDINATOR_ID = '01HZZZZZZZZZZZZZZZZZZZZZA2';
const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZA3';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZA4';
const REQUEST_ID = '01HZZZZZZZZZZZZZZZZZZZZZA5';

// ─── Mock fixtures ────────────────────────────────────────────────────────────

const mockPatient = {
  id: PATIENT_ID,
  userId: PATIENT_USER_ID,
  name: 'Ada Okafor',
  phone: '+2348000000001',
  conditionTags: ['hypertension'],
  hmoId: ORG_ID,
  directContactShared: false,
};

const mockLinkRequest = {
  id: REQUEST_ID,
  patientId: PATIENT_ID,
  orgId: ORG_ID,
  status: HmoLinkRequestStatus.PENDING,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
};

const mockCareEvent = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZA6',
  patientId: PATIENT_ID,
  type: CareEventType.CLINIC_VISIT,
  eventDate: '2025-01-15',
  structured: { diagnosis: 'hypertension' },
};

const mockSummary = {
  patient: mockPatient,
  careEvents: [mockCareEvent],
};

// ─── Service mock ─────────────────────────────────────────────────────────────

const mockPatientsService = {
  createPatient: jest.fn(),
  getMyProfile: jest.fn(),
  updateMyProfile: jest.fn(),
  getMyLinkRequests: jest.fn(),
  respondToLinkRequest: jest.fn(),
  lookupPatient: jest.fn(),
  createLinkRequest: jest.fn(),
  getPatientById: jest.fn(),
  getCareEvents: jest.fn(),
  createCareEvent: jest.fn(),
  getPatientSummary: jest.fn(),
};

// ─── Guard helpers ────────────────────────────────────────────────────────────

interface UserOverride {
  sub: string;
  role: string;
  orgId?: string;
}

function makeAllowGuard(user: UserOverride) {
  return {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = user;
      return true;
    },
  };
}

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

// ─── App factory ──────────────────────────────────────────────────────────────

async function buildApp(
  user: UserOverride = { sub: PATIENT_USER_ID, role: UserRole.PATIENT },
  roleGuardOverride: { canActivate: (ctx: ExecutionContext) => boolean | never } = makeAllowGuard(user),
): Promise<INestApplication> {
  const allowGuard = makeAllowGuard(user);

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [PatientsController],
    providers: [{ provide: PatientsService, useValue: mockPatientsService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(allowGuard)
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

function coordinatorApp(roleGuardOverride = makeAllowGuard({ sub: COORDINATOR_ID, role: UserRole.HMO_COORDINATOR, orgId: ORG_ID })) {
  return buildApp({ sub: COORDINATOR_ID, role: UserRole.HMO_COORDINATOR, orgId: ORG_ID }, roleGuardOverride);
}

function patientApp(roleGuardOverride = makeAllowGuard({ sub: PATIENT_USER_ID, role: UserRole.PATIENT })) {
  return buildApp({ sub: PATIENT_USER_ID, role: UserRole.PATIENT }, roleGuardOverride);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PatientsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should be defined', async () => {
    app = await patientApp();
    expect(app.get(PatientsController)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /patients/me  (patient)
  // ---------------------------------------------------------------------------

  describe('GET /patients/me', () => {
    it('returns 200 with patient profile', async () => {
      app = await patientApp();
      mockPatientsService.getMyProfile.mockResolvedValue(mockPatient);

      const res = await request(app.getHttpServer()).get('/patients/me');

      expect(res.status).toBe(200);
      expect(mockPatientsService.getMyProfile).toHaveBeenCalledWith(PATIENT_USER_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await patientApp(denyGuard);
      const res = await request(app.getHttpServer()).get('/patients/me');
      expect(res.status).toBe(403);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await patientApp();
      mockPatientsService.getMyProfile.mockRejectedValue(new NotFoundException('Patient profile not found'));
      const res = await request(app.getHttpServer()).get('/patients/me');
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /patients/me  (patient)
  // ---------------------------------------------------------------------------

  describe('PATCH /patients/me', () => {
    it('returns 200 with updated profile', async () => {
      app = await patientApp();
      mockPatientsService.updateMyProfile.mockResolvedValue({ ...mockPatient, name: 'Ada Updated' });

      const res = await request(app.getHttpServer())
        .patch('/patients/me')
        .send({ name: 'Ada Updated' });

      expect(res.status).toBe(200);
      expect(mockPatientsService.updateMyProfile).toHaveBeenCalledWith(
        PATIENT_USER_ID,
        expect.objectContaining({ name: 'Ada Updated' }),
      );
    });

    it('returns 422 when body contains unknown field (forbidNonWhitelisted)', async () => {
      app = await patientApp();
      const res = await request(app.getHttpServer())
        .patch('/patients/me')
        .send({ unknownField: 'value' });
      expect(res.status).toBe(422);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await patientApp();
      mockPatientsService.updateMyProfile.mockRejectedValue(new NotFoundException('Profile not found'));
      const res = await request(app.getHttpServer())
        .patch('/patients/me')
        .send({ name: 'New Name' });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /patients/me/link-requests  (patient)
  // ---------------------------------------------------------------------------

  describe('GET /patients/me/link-requests', () => {
    it('returns 200 with link request list', async () => {
      app = await patientApp();
      mockPatientsService.getMyLinkRequests.mockResolvedValue([mockLinkRequest]);

      const res = await request(app.getHttpServer()).get('/patients/me/link-requests');

      expect(res.status).toBe(200);
      expect(mockPatientsService.getMyLinkRequests).toHaveBeenCalledWith(PATIENT_USER_ID, undefined);
    });

    it('passes status query param to service', async () => {
      app = await patientApp();
      mockPatientsService.getMyLinkRequests.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/patients/me/link-requests?status=pending');

      expect(mockPatientsService.getMyLinkRequests).toHaveBeenCalledWith(
        PATIENT_USER_ID,
        HmoLinkRequestStatus.PENDING,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /patients/me/link-requests/:requestId  (patient)
  // ---------------------------------------------------------------------------

  describe('PATCH /patients/me/link-requests/:requestId', () => {
    it('returns 200 on successful approve', async () => {
      app = await patientApp();
      mockPatientsService.respondToLinkRequest.mockResolvedValue({
        ...mockLinkRequest,
        status: HmoLinkRequestStatus.APPROVED,
      });

      const res = await request(app.getHttpServer())
        .patch(`/patients/me/link-requests/${REQUEST_ID}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
      expect(mockPatientsService.respondToLinkRequest).toHaveBeenCalledWith(
        REQUEST_ID,
        PATIENT_USER_ID,
        'approve',
      );
    });

    it('returns 422 when action is invalid', async () => {
      app = await patientApp();
      const res = await request(app.getHttpServer())
        .patch(`/patients/me/link-requests/${REQUEST_ID}`)
        .send({ action: 'invalid' });
      expect(res.status).toBe(422);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await patientApp();
      mockPatientsService.respondToLinkRequest.mockRejectedValue(new NotFoundException('Link request not found'));
      const res = await request(app.getHttpServer())
        .patch(`/patients/me/link-requests/${REQUEST_ID}`)
        .send({ action: 'reject' });
      expect(res.status).toBe(404);
    });

    it('returns 410 when service throws HttpException with GONE status', async () => {
      app = await patientApp();
      mockPatientsService.respondToLinkRequest.mockRejectedValue(
        new HttpException('Link request has expired', HttpStatus.GONE),
      );
      const res = await request(app.getHttpServer())
        .patch(`/patients/me/link-requests/${REQUEST_ID}`)
        .send({ action: 'approve' });
      expect(res.status).toBe(410);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /patients  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('POST /patients', () => {
    const validBody = {
      name: 'New Patient',
      email: 'patient@example.com',
      phone: '+2348000000002',
      conditionTags: [],
    };

    it('returns 201 with created patient', async () => {
      app = await coordinatorApp();
      mockPatientsService.createPatient.mockResolvedValue(mockPatient);

      const res = await request(app.getHttpServer())
        .post('/patients')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(mockPatientsService.createPatient).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Patient', email: 'patient@example.com' }),
        ORG_ID,
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await coordinatorApp(denyGuard);
      const res = await request(app.getHttpServer()).post('/patients').send(validBody);
      expect(res.status).toBe(403);
    });

    it('returns 422 when required field is missing', async () => {
      app = await coordinatorApp();
      const res = await request(app.getHttpServer())
        .post('/patients')
        .send({ name: 'Missing email and phone' });
      expect(res.status).toBe(422);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await coordinatorApp();
      mockPatientsService.createPatient.mockRejectedValue(
        new ConflictException('Phone number already registered'),
      );
      const res = await request(app.getHttpServer()).post('/patients').send(validBody);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /patients/lookup  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('GET /patients/lookup', () => {
    it('returns 200 when patient is found', async () => {
      app = await coordinatorApp();
      mockPatientsService.lookupPatient.mockResolvedValue(mockPatient);

      const res = await request(app.getHttpServer())
        .get('/patients/lookup?phone=%2B2348000000001');

      expect(res.status).toBe(200);
      expect(mockPatientsService.lookupPatient).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+2348000000001' }),
        ORG_ID,
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await coordinatorApp(denyGuard);
      const res = await request(app.getHttpServer()).get('/patients/lookup?phone=123');
      expect(res.status).toBe(403);
    });

    it('returns 400 when service throws BadRequestException', async () => {
      app = await coordinatorApp();
      mockPatientsService.lookupPatient.mockRejectedValue(
        new BadRequestException('At least one of phone or membershipNumber is required'),
      );
      const res = await request(app.getHttpServer()).get('/patients/lookup');
      expect(res.status).toBe(400);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await coordinatorApp();
      mockPatientsService.lookupPatient.mockRejectedValue(new NotFoundException('Patient not found'));
      const res = await request(app.getHttpServer()).get('/patients/lookup?phone=000');
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /patients/:id/link-request  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('POST /patients/:id/link-request', () => {
    it('returns 201 with created link request', async () => {
      app = await coordinatorApp();
      mockPatientsService.createLinkRequest.mockResolvedValue(mockLinkRequest);

      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/link-request`);

      expect(res.status).toBe(201);
      expect(mockPatientsService.createLinkRequest).toHaveBeenCalledWith(PATIENT_ID, ORG_ID);
    });

    it('returns 403 when service throws ForbiddenException', async () => {
      app = await coordinatorApp();
      mockPatientsService.createLinkRequest.mockRejectedValue(
        new ForbiddenException('Patient does not have an active HMO_CARE consent grant'),
      );
      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/link-request`);
      expect(res.status).toBe(403);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await coordinatorApp();
      mockPatientsService.createLinkRequest.mockRejectedValue(
        new ConflictException('Patient is already linked to an HMO'),
      );
      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/link-request`);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /patients/:id  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('GET /patients/:id', () => {
    it('returns 200 with patient', async () => {
      app = await coordinatorApp();
      mockPatientsService.getPatientById.mockResolvedValue(mockPatient);

      const res = await request(app.getHttpServer()).get(`/patients/${PATIENT_ID}`);

      expect(res.status).toBe(200);
      expect(mockPatientsService.getPatientById).toHaveBeenCalledWith(PATIENT_ID, ORG_ID);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await coordinatorApp();
      mockPatientsService.getPatientById.mockRejectedValue(
        new NotFoundException('Patient not found or not within org scope'),
      );
      const res = await request(app.getHttpServer()).get(`/patients/${PATIENT_ID}`);
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /patients/:id/events  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('GET /patients/:id/events', () => {
    it('returns 200 with events and nextCursor', async () => {
      app = await coordinatorApp();
      mockPatientsService.getCareEvents.mockResolvedValue({
        events: [mockCareEvent],
        nextCursor: undefined,
      });

      const res = await request(app.getHttpServer()).get(`/patients/${PATIENT_ID}/events`);

      expect(res.status).toBe(200);
      expect(mockPatientsService.getCareEvents).toHaveBeenCalledWith(
        PATIENT_ID,
        ORG_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('passes cursor and type query params to service', async () => {
      app = await coordinatorApp();
      mockPatientsService.getCareEvents.mockResolvedValue({ events: [], nextCursor: undefined });
      const cursor = '01HZZZZZZZZZZZZZZZZZZZZZA0';

      await request(app.getHttpServer())
        .get(`/patients/${PATIENT_ID}/events?cursor=${cursor}&limit=5&type=lab_result`);

      expect(mockPatientsService.getCareEvents).toHaveBeenCalledWith(
        PATIENT_ID,
        ORG_ID,
        expect.objectContaining({ cursor, limit: 5, type: CareEventType.LAB_RESULT }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /patients/:id/events  (hmo_coordinator)
  // ---------------------------------------------------------------------------

  describe('POST /patients/:id/events', () => {
    const validBody = {
      type: CareEventType.CLINIC_VISIT,
      eventDate: '2025-01-15',
      structured: { diagnosis: 'hypertension' },
    };

    it('returns 201 with created care event', async () => {
      app = await coordinatorApp();
      mockPatientsService.createCareEvent.mockResolvedValue(mockCareEvent);

      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/events`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(mockPatientsService.createCareEvent).toHaveBeenCalledWith(
        PATIENT_ID,
        ORG_ID,
        expect.objectContaining({ type: CareEventType.CLINIC_VISIT }),
      );
    });

    it('returns 422 when required fields are missing', async () => {
      app = await coordinatorApp();
      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/events`)
        .send({ type: CareEventType.CLINIC_VISIT }); // missing eventDate + structured
      expect(res.status).toBe(422);
    });

    it('returns 422 when type is invalid', async () => {
      app = await coordinatorApp();
      const res = await request(app.getHttpServer())
        .post(`/patients/${PATIENT_ID}/events`)
        .send({ ...validBody, type: 'invalid_type' });
      expect(res.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /patients/:id/summary  (hmo_coordinator + export token)
  // ---------------------------------------------------------------------------

  describe('GET /patients/:id/summary', () => {
    it('returns 200 with summary when export token is in Authorization header', async () => {
      app = await coordinatorApp();
      mockPatientsService.getPatientSummary.mockResolvedValue(mockSummary);

      const res = await request(app.getHttpServer())
        .get(`/patients/${PATIENT_ID}/summary`)
        .set('Authorization', 'Bearer fake-export-token');

      expect(res.status).toBe(200);
      expect(mockPatientsService.getPatientSummary).toHaveBeenCalledWith(
        PATIENT_ID,
        ORG_ID,
        'fake-export-token',
      );
    });

    it('returns 401 when Authorization header is absent', async () => {
      app = await coordinatorApp();
      const res = await request(app.getHttpServer()).get(`/patients/${PATIENT_ID}/summary`);
      expect(res.status).toBe(401);
    });

    it('returns 401 when service throws UnauthorizedException', async () => {
      app = await coordinatorApp();
      mockPatientsService.getPatientSummary.mockRejectedValue(
        new UnauthorizedException('Export token does not match requested patient'),
      );
      const res = await request(app.getHttpServer())
        .get(`/patients/${PATIENT_ID}/summary`)
        .set('Authorization', 'Bearer wrong-token');
      expect(res.status).toBe(401);
    });
  });
});
