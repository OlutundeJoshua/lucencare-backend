import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';

import { AppointmentConfirmationAction, AppointmentStatus, AppointmentType } from 'src/common/enums';
import { MAIL_QUEUE, SEND_APPOINTMENT_CONFIRMATION_JOB } from 'src/queues/queues.constants';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { AppointmentsService } from './appointments.service';
import { Appointment } from './entities/appointment.entity';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZD1';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZD2';
const APPOINTMENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZD3';

const mockPatient: Partial<Patient> = { id: PATIENT_ID, userId: USER_ID, name: 'Jane Doe' };
const mockUser: Partial<User> = { id: USER_ID, email: 'jane@example.com' };

const mockAppointment: Partial<Appointment> = {
  id: APPOINTMENT_ID,
  patientId: PATIENT_ID,
  appointmentDate: '2026-08-01',
  time: '10:30 AM',
  duration: '30 min',
  provider: 'Dr. Sarah Chen',
  specialty: 'General Practice',
  facility: 'Lucen Health Centre, Lagos',
  type: AppointmentType.CONSULTATION,
  status: AppointmentStatus.CONFIRMED,
};

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  let appointmentRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let userRepo: { findOne: jest.Mock };
  let patientsService: { getMyProfile: jest.Mock };
  let mailQueue: { add: jest.Mock };

  beforeEach(async () => {
    appointmentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ ...mockAppointment, ...data })),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      })),
    };
    userRepo = { findOne: jest.fn().mockResolvedValue(mockUser) };
    patientsService = { getMyProfile: jest.fn().mockResolvedValue(mockPatient) };
    mailQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: getRepositoryToken(Appointment), useValue: appointmentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PatientsService, useValue: patientsService },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  describe('listAppointments', () => {
    it('returns appointments scoped to the resolved patient', async () => {
      appointmentRepo.find.mockResolvedValue([mockAppointment]);
      const result = await service.listAppointments(USER_ID);

      expect(patientsService.getMyProfile).toHaveBeenCalledWith(USER_ID);
      expect(appointmentRepo.find).toHaveBeenCalledWith({
        where: { patientId: PATIENT_ID },
        order: { appointmentDate: 'ASC' },
      });
      expect(result).toEqual([mockAppointment]);
    });
  });

  describe('createAppointment', () => {
    it('creates an appointment with status CONFIRMED and enqueues a confirmation email', async () => {
      const dto = {
        appointmentDate: '2026-08-01',
        time: '10:30 AM',
        duration: '30 min',
        provider: 'Dr. Sarah Chen',
        specialty: 'General Practice',
        facility: 'Lucen Health Centre, Lagos',
        type: AppointmentType.CONSULTATION,
      };

      const result = await service.createAppointment(USER_ID, dto);

      expect(appointmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: PATIENT_ID, status: AppointmentStatus.CONFIRMED }),
      );
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPOINTMENT_CONFIRMATION_JOB,
        expect.objectContaining({
          to: mockUser.email,
          provider: dto.provider,
          action: AppointmentConfirmationAction.CREATED,
        }),
      );
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    });
  });

  describe('updateAppointment', () => {
    it('throws NotFoundException when the appointment does not belong to the caller', async () => {
      appointmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateAppointment(USER_ID, APPOINTMENT_ID, { provider: 'New provider' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies a partial update without touching status', async () => {
      appointmentRepo.findOne.mockResolvedValue(mockAppointment);

      await service.updateAppointment(USER_ID, APPOINTMENT_ID, { provider: 'Dr. New' });

      expect(appointmentRepo.update).toHaveBeenCalledWith(
        { id: APPOINTMENT_ID },
        { provider: 'Dr. New' },
      );
    });
  });

  describe('rescheduleAppointment', () => {
    it('resets status to CONFIRMED and re-sends the confirmation email', async () => {
      appointmentRepo.findOne.mockResolvedValue({ ...mockAppointment, status: AppointmentStatus.PENDING });

      await service.rescheduleAppointment(USER_ID, APPOINTMENT_ID, {
        appointmentDate: '2026-08-10',
        time: '2:00 PM',
        duration: '45 min',
      });

      expect(appointmentRepo.update).toHaveBeenCalledWith(
        { id: APPOINTMENT_ID },
        expect.objectContaining({ status: AppointmentStatus.CONFIRMED, appointmentDate: '2026-08-10' }),
      );
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPOINTMENT_CONFIRMATION_JOB,
        expect.objectContaining({ action: AppointmentConfirmationAction.RESCHEDULED }),
      );
    });

    it('throws ConflictException when the appointment is already cancelled', async () => {
      appointmentRepo.findOne.mockResolvedValue({ ...mockAppointment, status: AppointmentStatus.CANCELLED });

      await expect(
        service.rescheduleAppointment(USER_ID, APPOINTMENT_ID, {
          appointmentDate: '2026-08-10',
          time: '2:00 PM',
          duration: '45 min',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelAppointment', () => {
    it('sets status to CANCELLED', async () => {
      appointmentRepo.findOne.mockResolvedValue(mockAppointment);

      await service.cancelAppointment(USER_ID, APPOINTMENT_ID);

      expect(appointmentRepo.update).toHaveBeenCalledWith(
        { id: APPOINTMENT_ID },
        { status: AppointmentStatus.CANCELLED },
      );
    });

    it('throws ConflictException when already completed', async () => {
      appointmentRepo.findOne.mockResolvedValue({ ...mockAppointment, status: AppointmentStatus.COMPLETED });

      await expect(service.cancelAppointment(USER_ID, APPOINTMENT_ID)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the appointment does not belong to the caller', async () => {
      appointmentRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelAppointment(USER_ID, APPOINTMENT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('returns aggregate counts for the resolved patient', async () => {
      appointmentRepo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const result = await service.getStats(USER_ID);

      expect(result).toEqual(
        expect.objectContaining({ upcoming: 0, thisMonth: 0, completed: 2, cancelled: 1 }),
      );
    });
  });
});
