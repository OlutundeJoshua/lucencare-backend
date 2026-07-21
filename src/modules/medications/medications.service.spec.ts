import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditAction, DoseStatus, NotificationType } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { MedicationsService } from './medications.service';
import { Medication } from './entities/medication.entity';
import { MedicationDoseLog } from './entities/medication-dose-log.entity';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZB1';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZB2';
const MEDICATION_ID = '01HZZZZZZZZZZZZZZZZZZZZZB3';

const mockPatient: Partial<Patient> = { id: PATIENT_ID, userId: USER_ID, timezone: 'Africa/Lagos' };

const mockMedication: Partial<Medication> = {
  id: MEDICATION_ID,
  patientId: PATIENT_ID,
  name: 'Metformin',
  dosage: '500 mg',
  condition: 'Type 2 Diabetes',
  frequency: 'Twice daily',
  scheduleTimes: ['8:00 AM', '8:00 PM'],
  prescriber: 'Dr. Chen',
  specialty: 'Endocrinology',
  pillsRemaining: 24,
  pillsTotal: 60,
  refillDate: '2026-08-01',
};

function makeInsertQueryBuilderMock() {
  return {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
}

function makeUpdateQueryBuilderMock() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
}

describe('MedicationsService', () => {
  let service: MedicationsService;

  let medicationRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let doseLogRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let patientRepo: { update: jest.Mock; find: jest.Mock };
  let userRepo: { find: jest.Mock };
  let patientsService: { getMyProfile: jest.Mock };
  let auditService: { log: jest.Mock };
  let notificationsService: { createOne: jest.Mock };

  beforeEach(async () => {
    medicationRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ ...mockMedication, ...data })),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => makeUpdateQueryBuilderMock()),
    };
    doseLogRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'log-1', ...data })),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => makeInsertQueryBuilderMock()),
    };
    patientRepo = { update: jest.fn().mockResolvedValue(undefined), find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    patientsService = { getMyProfile: jest.fn().mockResolvedValue(mockPatient) };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    notificationsService = { createOne: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicationsService,
        { provide: getRepositoryToken(Medication), useValue: medicationRepo },
        { provide: getRepositoryToken(MedicationDoseLog), useValue: doseLogRepo },
        { provide: getRepositoryToken(Patient), useValue: patientRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PatientsService, useValue: patientsService },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<MedicationsService>(MedicationsService);
  });

  describe('listMedications', () => {
    it('returns medications scoped to the resolved patient', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);
      const result = await service.listMedications(USER_ID);

      expect(patientsService.getMyProfile).toHaveBeenCalledWith(USER_ID);
      expect(medicationRepo.find).toHaveBeenCalledWith({ where: { patientId: PATIENT_ID }, order: { id: 'ASC' } });
      expect(result).toEqual([mockMedication]);
    });
  });

  describe('createMedication', () => {
    it('creates a medication with pillsRemaining seeded from pillsTotal and syncs the patient summary', async () => {
      const dto = {
        name: 'Metformin',
        dosage: '500 mg',
        condition: 'Type 2 Diabetes',
        frequency: 'Twice daily',
        scheduleTimes: ['8:00 AM', '8:00 PM'],
        prescriber: 'Dr. Chen',
        specialty: 'Endocrinology',
        pillsTotal: 60,
        refillDate: '2026-08-01',
      };

      const result = await service.createMedication(USER_ID, dto);

      expect(medicationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: PATIENT_ID, pillsRemaining: 60, pillsTotal: 60 }),
      );
      expect(patientRepo.update).toHaveBeenCalledWith({ id: PATIENT_ID }, { medicationList: [] });
      expect(result.pillsRemaining).toBe(60);
    });
  });

  describe('updateMedication / deleteMedication', () => {
    it('throws NotFoundException when the medication does not belong to the caller', async () => {
      medicationRepo.findOne.mockResolvedValue(null);

      await expect(service.updateMedication(USER_ID, MEDICATION_ID, { name: 'New name' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes an owned medication and re-syncs the patient summary', async () => {
      medicationRepo.findOne
        .mockResolvedValueOnce(mockMedication) // ownership check
        .mockResolvedValueOnce({ ...mockMedication, deletedAt: new Date() }); // withDeleted re-fetch

      const result = await service.deleteMedication(USER_ID, MEDICATION_ID);

      expect(medicationRepo.softDelete).toHaveBeenCalledWith({ id: MEDICATION_ID });
      expect(result.id).toBe(MEDICATION_ID);
      expect(result.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('logDose', () => {
    it('decrements pillsRemaining when a dose transitions into TAKEN', async () => {
      medicationRepo.findOne.mockResolvedValue(mockMedication);
      doseLogRepo.findOne.mockResolvedValue(null);

      await service.logDose(USER_ID, MEDICATION_ID, { scheduledTime: '8:00 AM', status: DoseStatus.TAKEN });

      const updateQb = medicationRepo.createQueryBuilder.mock.results[0].value;
      expect(updateQb.set).toHaveBeenCalledWith({ pillsRemaining: expect.any(Function) });
    });

    it('does not decrement pillsRemaining again if the dose was already TAKEN', async () => {
      medicationRepo.findOne.mockResolvedValue(mockMedication);
      doseLogRepo.findOne.mockResolvedValue({
        id: 'log-1',
        medicationId: MEDICATION_ID,
        status: DoseStatus.TAKEN,
      });

      await service.logDose(USER_ID, MEDICATION_ID, { scheduledTime: '8:00 AM', status: DoseStatus.TAKEN });

      expect(medicationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getRefillAlerts', () => {
    it('classifies medications by refill urgency and counts the rest as ok', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      const urgentMed = { ...mockMedication, id: 'urgent-1', refillDate: soon.toISOString().slice(0, 10) };

      const far = new Date();
      far.setDate(far.getDate() + 60);
      const okMed = { ...mockMedication, id: 'ok-1', refillDate: far.toISOString().slice(0, 10) };

      medicationRepo.find.mockResolvedValue([urgentMed, okMed]);

      const result = await service.getRefillAlerts(USER_ID);

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].urgency).toBe('urgent');
      expect(result.okCount).toBe(1);
    });
  });

  describe('requestRefill', () => {
    it('writes an audit log entry and creates a notification', async () => {
      medicationRepo.findOne.mockResolvedValue(mockMedication);

      await service.requestRefill(USER_ID, MEDICATION_ID);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: USER_ID,
          action: AuditAction.MEDICATION_REFILL_REQUESTED,
          resourceId: MEDICATION_ID,
        }),
      );
      expect(notificationsService.createOne).toHaveBeenCalledWith(
        USER_ID,
        NotificationType.REFILL_ALERT,
        expect.objectContaining({ medicationId: MEDICATION_ID, source: 'patient_request' }),
      );
    });

    it('throws NotFoundException for a medication the caller does not own', async () => {
      medicationRepo.findOne.mockResolvedValue(null);
      await expect(service.requestRefill(USER_ID, MEDICATION_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('registerReminders / unregisterReminders', () => {
    it('enables reminders with the given timezone', async () => {
      await service.registerReminders(USER_ID, { timezone: 'Africa/Lagos' });
      expect(patientRepo.update).toHaveBeenCalledWith(
        { id: PATIENT_ID },
        { timezone: 'Africa/Lagos', medicationRemindersEnabled: true },
      );
    });

    it('disables reminders', async () => {
      await service.unregisterReminders(USER_ID);
      expect(patientRepo.update).toHaveBeenCalledWith({ id: PATIENT_ID }, { medicationRemindersEnabled: false });
    });
  });

  describe('findDueReminderTargets', () => {
    it('returns a target when the current local time matches a scheduled slot', async () => {
      patientRepo.find.mockResolvedValue([mockPatient]);
      medicationRepo.find.mockResolvedValue([mockMedication]);
      userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);

      // 8:00 AM in Africa/Lagos (UTC+1) is 07:00 UTC
      const now = new Date('2026-07-17T07:00:00.000Z');

      const targets = await service.findDueReminderTargets(now);

      expect(targets).toEqual([
        { email: 'patient@example.com', medicationName: 'Metformin', dosage: '500 mg', scheduledTime: '8:00 AM' },
      ]);
    });

    it('returns nothing when no patients have reminders enabled', async () => {
      patientRepo.find.mockResolvedValue([]);
      const targets = await service.findDueReminderTargets(new Date());
      expect(targets).toEqual([]);
    });
  });
});
