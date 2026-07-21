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
import { DoseStatus } from 'src/common/enums';

import { MedicationsController } from './medications.controller';
import { MedicationsService } from './medications.service';

const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZC1';
const MEDICATION_ID = '01HZZZZZZZZZZZZZZZZZZZZZC2';

const mockMedication = {
  id: MEDICATION_ID,
  name: 'Metformin',
  dosage: '500 mg',
  condition: 'Type 2 Diabetes',
  frequency: 'Twice daily',
  scheduleTimes: ['8:00 AM', '8:00 PM'],
  prescriber: 'Dr. Chen',
  specialty: 'Endocrinology',
  pillsRemaining: 60,
  pillsTotal: 60,
  refillDate: '2026-08-01',
};

const mockMedicationsService = {
  listMedications: jest.fn(),
  createMedication: jest.fn(),
  updateMedication: jest.fn(),
  deleteMedication: jest.fn(),
  getSchedule: jest.fn(),
  getRefillAlerts: jest.fn(),
  getStats: jest.fn(),
  registerReminders: jest.fn(),
  unregisterReminders: jest.fn(),
  logDose: jest.fn(),
  requestRefill: jest.fn(),
};

const allowAllGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'patient' };
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
    controllers: [MedicationsController],
    providers: [{ provide: MedicationsService, useValue: mockMedicationsService }],
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

describe('MedicationsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /medications', () => {
    it('returns 200 with the medication list', async () => {
      app = await buildApp();
      mockMedicationsService.listMedications.mockResolvedValue([mockMedication]);

      const res = await request(app.getHttpServer()).get('/medications');

      expect(res.status).toBe(200);
      expect(mockMedicationsService.listMedications).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);
      const res = await request(app.getHttpServer()).get('/medications');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /medications', () => {
    const validBody = {
      name: 'Metformin',
      dosage: '500 mg',
      condition: 'Type 2 Diabetes',
      frequency: 'Twice daily',
      scheduleTimes: ['8:00 AM'],
      prescriber: 'Dr. Chen',
      specialty: 'Endocrinology',
      pillsTotal: 60,
      refillDate: '2026-08-01',
    };

    it('returns 201 on success', async () => {
      app = await buildApp();
      mockMedicationsService.createMedication.mockResolvedValue(mockMedication);

      const res = await request(app.getHttpServer()).post('/medications').send(validBody);

      expect(res.status).toBe(201);
      expect(mockMedicationsService.createMedication).toHaveBeenCalledWith(TEST_USER_ID, validBody);
    });

    it('returns 422 when required fields are missing', async () => {
      app = await buildApp();
      const res = await request(app.getHttpServer()).post('/medications').send({ name: 'Metformin' });
      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /medications/:id', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.updateMedication.mockResolvedValue(mockMedication);

      const res = await request(app.getHttpServer())
        .patch(`/medications/${MEDICATION_ID}`)
        .send({ pillsTotal: 90 });

      expect(res.status).toBe(200);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockMedicationsService.updateMedication.mockRejectedValue(new NotFoundException('Medication not found'));

      const res = await request(app.getHttpServer())
        .patch(`/medications/${MEDICATION_ID}`)
        .send({ pillsTotal: 90 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /medications/:id', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.deleteMedication.mockResolvedValue({ id: MEDICATION_ID, deletedAt: new Date() });

      const res = await request(app.getHttpServer()).delete(`/medications/${MEDICATION_ID}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /medications/schedule', () => {
    it('returns 200 with schedule slots', async () => {
      app = await buildApp();
      mockMedicationsService.getSchedule.mockResolvedValue({ date: '2026-07-17', slots: [] });

      const res = await request(app.getHttpServer()).get('/medications/schedule?date=2026-07-17');

      expect(res.status).toBe(200);
      expect(mockMedicationsService.getSchedule).toHaveBeenCalledWith(TEST_USER_ID, '2026-07-17');
    });
  });

  describe('POST /medications/:id/doses/log', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.logDose.mockResolvedValue({ id: 'log-1', status: DoseStatus.TAKEN });

      const res = await request(app.getHttpServer())
        .post(`/medications/${MEDICATION_ID}/doses/log`)
        .send({ scheduledTime: '8:00 AM', status: 'taken' });

      expect(res.status).toBe(200);
    });

    it('returns 422 for an invalid status value', async () => {
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post(`/medications/${MEDICATION_ID}/doses/log`)
        .send({ scheduledTime: '8:00 AM', status: 'not-a-status' });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /medications/refills', () => {
    it('returns 200 with refill alerts', async () => {
      app = await buildApp();
      mockMedicationsService.getRefillAlerts.mockResolvedValue({ alerts: [], okCount: 1 });

      const res = await request(app.getHttpServer()).get('/medications/refills');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /medications/:id/request-refill', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.requestRefill.mockResolvedValue({ requested: true });

      const res = await request(app.getHttpServer()).post(`/medications/${MEDICATION_ID}/request-refill`);
      expect(res.status).toBe(200);
    });

    it('returns 404 when the medication is not owned by the caller', async () => {
      app = await buildApp();
      mockMedicationsService.requestRefill.mockRejectedValue(new NotFoundException('Medication not found'));

      const res = await request(app.getHttpServer()).post(`/medications/${MEDICATION_ID}/request-refill`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /medications/stats', () => {
    it('returns 200 with aggregate stats', async () => {
      app = await buildApp();
      mockMedicationsService.getStats.mockResolvedValue({
        activeMeds: 5,
        takenToday: 4,
        dueToday: 2,
        adherenceStreakDays: 14,
      });

      const res = await request(app.getHttpServer()).get('/medications/stats');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /medications/reminders/register', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.registerReminders.mockResolvedValue({ registered: true });

      const res = await request(app.getHttpServer())
        .post('/medications/reminders/register')
        .send({ timezone: 'Africa/Lagos' });

      expect(res.status).toBe(200);
      expect(mockMedicationsService.registerReminders).toHaveBeenCalledWith(TEST_USER_ID, {
        timezone: 'Africa/Lagos',
      });
    });

    it('returns 422 when timezone is missing', async () => {
      app = await buildApp();
      const res = await request(app.getHttpServer()).post('/medications/reminders/register').send({});
      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /medications/reminders/unregister', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockMedicationsService.unregisterReminders.mockResolvedValue({ registered: false });

      const res = await request(app.getHttpServer()).delete('/medications/reminders/unregister');
      expect(res.status).toBe(200);
    });
  });
});
