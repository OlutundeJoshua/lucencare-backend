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
import { AppointmentStatus, AppointmentType } from 'src/common/enums';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZE1';
const APPOINTMENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZE2';

const mockAppointment = {
  id: APPOINTMENT_ID,
  appointmentDate: '2026-08-01',
  time: '10:30 AM',
  duration: '30 min',
  provider: 'Dr. Sarah Chen',
  specialty: 'General Practice',
  facility: 'Lucen Health Centre, Lagos',
  type: AppointmentType.CONSULTATION,
  status: AppointmentStatus.CONFIRMED,
};

const mockAppointmentsService = {
  listAppointments: jest.fn(),
  createAppointment: jest.fn(),
  updateAppointment: jest.fn(),
  rescheduleAppointment: jest.fn(),
  cancelAppointment: jest.fn(),
  getStats: jest.fn(),
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
    controllers: [AppointmentsController],
    providers: [{ provide: AppointmentsService, useValue: mockAppointmentsService }],
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

describe('AppointmentsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /appointments', () => {
    it('returns 200 with the appointment list', async () => {
      app = await buildApp();
      mockAppointmentsService.listAppointments.mockResolvedValue([mockAppointment]);

      const res = await request(app.getHttpServer()).get('/appointments');

      expect(res.status).toBe(200);
      expect(mockAppointmentsService.listAppointments).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildApp(denyGuard);
      const res = await request(app.getHttpServer()).get('/appointments');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /appointments', () => {
    const validBody = {
      appointmentDate: '2026-08-01',
      time: '10:30 AM',
      duration: '30 min',
      provider: 'Dr. Sarah Chen',
      specialty: 'General Practice',
      facility: 'Lucen Health Centre, Lagos',
      type: 'consultation',
    };

    it('returns 201 on success', async () => {
      app = await buildApp();
      mockAppointmentsService.createAppointment.mockResolvedValue(mockAppointment);

      const res = await request(app.getHttpServer()).post('/appointments').send(validBody);

      expect(res.status).toBe(201);
      expect(mockAppointmentsService.createAppointment).toHaveBeenCalledWith(TEST_USER_ID, validBody);
    });

    it('returns 422 when required fields are missing', async () => {
      app = await buildApp();
      const res = await request(app.getHttpServer()).post('/appointments').send({ provider: 'Dr. Chen' });
      expect(res.status).toBe(422);
    });

    it('returns 422 for an invalid type value', async () => {
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .post('/appointments')
        .send({ ...validBody, type: 'not-a-type' });
      expect(res.status).toBe(422);
    });
  });

  describe('GET /appointments/stats', () => {
    it('returns 200 with aggregate stats', async () => {
      app = await buildApp();
      mockAppointmentsService.getStats.mockResolvedValue({
        upcoming: 3,
        thisMonth: 2,
        completed: 5,
        cancelled: 1,
      });

      const res = await request(app.getHttpServer()).get('/appointments/stats');
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /appointments/:id', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockAppointmentsService.updateAppointment.mockResolvedValue(mockAppointment);

      const res = await request(app.getHttpServer())
        .patch(`/appointments/${APPOINTMENT_ID}`)
        .send({ provider: 'Dr. New' });

      expect(res.status).toBe(200);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      app = await buildApp();
      mockAppointmentsService.updateAppointment.mockRejectedValue(new NotFoundException('Appointment not found'));

      const res = await request(app.getHttpServer())
        .patch(`/appointments/${APPOINTMENT_ID}`)
        .send({ provider: 'Dr. New' });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /appointments/:id/reschedule', () => {
    const validBody = { appointmentDate: '2026-08-10', time: '2:00 PM', duration: '45 min' };

    it('returns 200 on success', async () => {
      app = await buildApp();
      mockAppointmentsService.rescheduleAppointment.mockResolvedValue(mockAppointment);

      const res = await request(app.getHttpServer())
        .patch(`/appointments/${APPOINTMENT_ID}/reschedule`)
        .send(validBody);

      expect(res.status).toBe(200);
      expect(mockAppointmentsService.rescheduleAppointment).toHaveBeenCalledWith(
        TEST_USER_ID,
        APPOINTMENT_ID,
        validBody,
      );
    });

    it('returns 409 when the appointment is cancelled or completed', async () => {
      app = await buildApp();
      mockAppointmentsService.rescheduleAppointment.mockRejectedValue(
        new ConflictException('Cannot reschedule a cancelled appointment'),
      );

      const res = await request(app.getHttpServer())
        .patch(`/appointments/${APPOINTMENT_ID}/reschedule`)
        .send(validBody);

      expect(res.status).toBe(409);
    });

    it('returns 422 when required fields are missing', async () => {
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .patch(`/appointments/${APPOINTMENT_ID}/reschedule`)
        .send({});
      expect(res.status).toBe(422);
    });
  });

  describe('POST /appointments/:id/cancel', () => {
    it('returns 200 on success', async () => {
      app = await buildApp();
      mockAppointmentsService.cancelAppointment.mockResolvedValue({
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
      });

      const res = await request(app.getHttpServer()).post(`/appointments/${APPOINTMENT_ID}/cancel`);
      expect(res.status).toBe(200);
    });

    it('returns 404 when the appointment is not owned by the caller', async () => {
      app = await buildApp();
      mockAppointmentsService.cancelAppointment.mockRejectedValue(new NotFoundException('Appointment not found'));

      const res = await request(app.getHttpServer()).post(`/appointments/${APPOINTMENT_ID}/cancel`);
      expect(res.status).toBe(404);
    });

    it('returns 409 when already cancelled or completed', async () => {
      app = await buildApp();
      mockAppointmentsService.cancelAppointment.mockRejectedValue(
        new ConflictException('Appointment is already cancelled'),
      );

      const res = await request(app.getHttpServer()).post(`/appointments/${APPOINTMENT_ID}/cancel`);
      expect(res.status).toBe(409);
    });
  });
});
