import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';

import {
  AppointmentConfirmationAction,
  AppointmentReminderLead,
  AppointmentStatus,
  AppointmentType,
} from 'src/common/enums';
import { MAIL_JOB_OPTIONS, MAIL_QUEUE, SEND_APPOINTMENT_CONFIRMATION_JOB } from 'src/queues/queues.constants';
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
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let patientRepo: { find: jest.Mock };
  let patientsService: { getMyProfile: jest.Mock };
  let configService: { get: jest.Mock };
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
    userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
      find: jest.fn().mockResolvedValue([mockUser]),
    };
    patientRepo = { find: jest.fn().mockResolvedValue([mockPatient]) };
    patientsService = { getMyProfile: jest.fn().mockResolvedValue(mockPatient) };
    // Matches the default tick cadence of */5. See the COUPLED PAIR note in app.config.ts.
    configService = {
      get: jest.fn((key: string) => (key === 'app.appointmentReminderWindowMinutes' ? 5 : undefined)),
    };
    mailQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: getRepositoryToken(Appointment), useValue: appointmentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Patient), useValue: patientRepo },
        { provide: PatientsService, useValue: patientsService },
        { provide: ConfigService, useValue: configService },
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
        MAIL_JOB_OPTIONS,
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
        MAIL_JOB_OPTIONS,
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

  describe('findDueReminderTargets', () => {
    /** The reminder scan reads through a query builder, not repo.find. */
    function arrangeScan(appointments: unknown[]) {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(appointments),
      };
      appointmentRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    /** Africa/Lagos is UTC+1, so 10:30 AM local is 09:30 UTC. */
    const lagosPatient = { ...mockPatient, timezone: 'Africa/Lagos' };

    beforeEach(() => {
      patientRepo.find.mockResolvedValue([lagosPatient]);
    });

    it('sends the three-day reminder exactly three days out', async () => {
      arrangeScan([mockAppointment]);

      // 2026-07-29 10:30 local is 72h before the 2026-08-01 10:30 appointment.
      const targets = await service.findDueReminderTargets(new Date('2026-07-29T09:30:00.000Z'));

      expect(targets).toHaveLength(1);
      expect(targets[0]).toEqual({
        email: 'jane@example.com',
        firstName: 'Jane',
        lead: AppointmentReminderLead.THREE_DAYS,
        appointmentType: AppointmentType.CONSULTATION,
        appointmentDate: '2026-08-01',
        time: '10:30 AM',
        facility: 'Lucen Health Centre, Lagos',
        provider: 'Dr. Sarah Chen',
      });
    });

    it('sends the one-hour reminder an hour out', async () => {
      arrangeScan([mockAppointment]);

      const targets = await service.findDueReminderTargets(new Date('2026-08-01T08:30:00.000Z'));

      expect(targets.map((t) => t.lead)).toEqual([AppointmentReminderLead.ONE_HOUR]);
    });

    it('sends the at-time reminder on the appointment itself', async () => {
      arrangeScan([mockAppointment]);

      const targets = await service.findDueReminderTargets(new Date('2026-08-01T09:30:00.000Z'));

      expect(targets.map((t) => t.lead)).toEqual([AppointmentReminderLead.AT_TIME]);
    });

    // The window is half-open, so consecutive ticks must not both claim the same
    // appointment for the same lead — that is one patient getting the email twice.
    it('claims an appointment for a lead on exactly one tick', async () => {
      arrangeScan([mockAppointment]);

      const ticks = [
        '2026-08-01T08:20:00.000Z',
        '2026-08-01T08:25:00.000Z',
        '2026-08-01T08:30:00.000Z',
        '2026-08-01T08:35:00.000Z',
        '2026-08-01T08:40:00.000Z',
      ];

      const oneHourHits: string[] = [];
      for (const tick of ticks) {
        const targets = await service.findDueReminderTargets(new Date(tick));
        if (targets.some((t) => t.lead === AppointmentReminderLead.ONE_HOUR)) oneHourHits.push(tick);
      }

      expect(oneHourHits).toEqual(['2026-08-01T08:30:00.000Z']);
    });

    it('sends nothing at a time that matches no lead', async () => {
      arrangeScan([mockAppointment]);

      const targets = await service.findDueReminderTargets(new Date('2026-08-01T05:00:00.000Z'));

      expect(targets).toEqual([]);
    });

    // Same rule the rest of the platform follows for free-form time strings: an
    // unreadable label is skipped, never guessed at.
    it('skips an appointment whose time label cannot be parsed', async () => {
      arrangeScan([{ ...mockAppointment, time: 'sometime in the morning' }]);

      const targets = await service.findDueReminderTargets(new Date('2026-08-01T09:30:00.000Z'));

      expect(targets).toEqual([]);
    });

    it('anchors the window to the patient timezone, not to UTC', async () => {
      patientRepo.find.mockResolvedValue([{ ...mockPatient, timezone: 'Asia/Kathmandu' }]);
      arrangeScan([mockAppointment]);

      // Kathmandu is UTC+5:45, a :45 offset that never lines up with a UTC-derived
      // window. 10:30 local on 2026-08-01 is 04:45 UTC.
      const targets = await service.findDueReminderTargets(new Date('2026-08-01T04:45:00.000Z'));

      expect(targets.map((t) => t.lead)).toEqual([AppointmentReminderLead.AT_TIME]);
    });

    it('returns nothing when the scan finds no appointments', async () => {
      arrangeScan([]);

      const targets = await service.findDueReminderTargets(new Date('2026-08-01T09:30:00.000Z'));

      expect(targets).toEqual([]);
      expect(patientRepo.find).not.toHaveBeenCalled();
    });

    it('excludes cancelled and completed appointments in the scan query', async () => {
      const qb = arrangeScan([]);

      await service.findDueReminderTargets(new Date('2026-08-01T09:30:00.000Z'));

      expect(qb.where).toHaveBeenCalledWith('a.status IN (:...statuses)', {
        statuses: [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING],
      });
    });
  });
});
