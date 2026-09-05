import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';

import {
  AuditAction,
  DoseStatus,
  MedicationReminderLead,
  NotificationType,
} from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { MedicationsService } from './medications.service';
import { Medication } from './entities/medication.entity';
import { MedicationDoseLog } from './entities/medication-dose-log.entity';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZB1';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZB2';
const MEDICATION_ID = '01HZZZZZZZZZZZZZZZZZZZZZB3';

const mockPatient: Partial<Patient> = {
  id: PATIENT_ID,
  userId: USER_ID,
  name: 'Ada Lovelace',
  timezone: 'Africa/Lagos',
};

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

/** The candidate read in markOverdueDosesMissed. */
function makeSelectQueryBuilderMock(rows: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

/** The bulk write in markOverdueDosesMissed — has andWhere and reports `affected`. */
function makeSweepUpdateQueryBuilderMock(affected: number) {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
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
  let configService: { get: jest.Mock };

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
    patientRepo = {
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    patientsService = { getMyProfile: jest.fn().mockResolvedValue(mockPatient) };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    notificationsService = { createOne: jest.fn().mockResolvedValue(undefined) };
    // Matches the default tick cadence of */30. See the COUPLED PAIR note in app.config.ts.
    configService = {
      // Must match the tick interval, as in app.config.ts — the leads are 30 and 0
      // minutes, so a wider window would let one tick claim a dose for both at once.
      get: jest.fn((key: string) =>
        key === 'app.medicationReminderWindowMinutes' ? 5 : undefined,
      ),
    };

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
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MedicationsService>(MedicationsService);
  });

  describe('listMedications', () => {
    it('returns medications scoped to the resolved patient', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);
      const result = await service.listMedications(USER_ID);

      expect(patientsService.getMyProfile).toHaveBeenCalledWith(USER_ID);
      expect(medicationRepo.find).toHaveBeenCalledWith({
        where: { patientId: PATIENT_ID },
        order: { id: 'ASC' },
      });
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

      await expect(
        service.updateMedication(USER_ID, MEDICATION_ID, { name: 'New name' }),
      ).rejects.toThrow(NotFoundException);
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

      await service.logDose(USER_ID, MEDICATION_ID, {
        scheduledTime: '8:00 AM',
        status: DoseStatus.TAKEN,
      });

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

      await service.logDose(USER_ID, MEDICATION_ID, {
        scheduledTime: '8:00 AM',
        status: DoseStatus.TAKEN,
      });

      expect(medicationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getSchedule', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('reports a PENDING dose as due_now when local time is within 15 minutes of the scheduled slot', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T07:05:00.000Z')); // 8:05 AM in Africa/Lagos (UTC+1)

      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue([
        {
          id: 'log-1',
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-22',
          scheduledTime: '8:00 AM',
          status: DoseStatus.PENDING,
        },
      ]);

      const result = await service.getSchedule(USER_ID);

      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].doses[0].status).toBe(DoseStatus.DUE_NOW);
    });

    it('reports a PENDING dose as pending only while it is still ahead', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T05:00:00.000Z')); // 6:00 AM in Africa/Lagos

      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue([
        {
          id: 'log-1',
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-22',
          scheduledTime: '8:00 AM',
          status: DoseStatus.PENDING,
        },
      ]);

      const result = await service.getSchedule(USER_ID);

      expect(result.slots[0].doses[0].status).toBe(DoseStatus.PENDING);
    });

    // The due-now window used to be symmetric (±15 min), so from 16 minutes late a
    // dose fell back to plain PENDING and the frontend labelled a dose already in the
    // past as "upcoming". PENDING now means "still ahead" and nothing else.
    it('does not report a past-due dose as pending once its slot has passed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T09:00:00.000Z')); // 10:00 AM in Africa/Lagos

      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue([
        {
          id: 'log-1',
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-22',
          scheduledTime: '8:00 AM',
          status: DoseStatus.PENDING,
        },
      ]);

      const result = await service.getSchedule(USER_ID);

      expect(result.slots[0].doses[0].status).toBe(DoseStatus.DUE_NOW);
    });

    it('returns a MISSED dose unchanged rather than overlaying due_now', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T07:05:00.000Z')); // 8:05 AM in Africa/Lagos

      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue([
        {
          id: 'log-1',
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-22',
          scheduledTime: '8:00 AM',
          status: DoseStatus.MISSED,
        },
      ]);

      const result = await service.getSchedule(USER_ID);

      expect(result.slots[0].doses[0].status).toBe(DoseStatus.MISSED);
    });

    it('does not overlay due_now onto a dose that is already TAKEN', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T07:05:00.000Z')); // 8:05 AM in Africa/Lagos

      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue([
        {
          id: 'log-1',
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-22',
          scheduledTime: '8:00 AM',
          status: DoseStatus.TAKEN,
        },
      ]);

      const result = await service.getSchedule(USER_ID);

      expect(result.slots[0].doses[0].status).toBe(DoseStatus.TAKEN);
    });
  });

  describe('getRefillAlerts', () => {
    it('classifies medications by refill urgency and counts the rest as ok', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      const urgentMed = {
        ...mockMedication,
        id: 'urgent-1',
        refillDate: soon.toISOString().slice(0, 10),
      };

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
      await expect(service.requestRefill(USER_ID, MEDICATION_ID)).rejects.toThrow(
        NotFoundException,
      );
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
      expect(patientRepo.update).toHaveBeenCalledWith(
        { id: PATIENT_ID },
        { medicationRemindersEnabled: false },
      );
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

      // firstName and streakDays are carried on the target because the reminder copy
      // quotes both — the mail processor has no repository access to look them up.
      expect(targets).toEqual([
        {
          email: 'patient@example.com',
          firstName: 'Ada',
          lead: MedicationReminderLead.AT_TIME,
          scheduledTime: '8:00 AM',
          medications: [{ name: 'Metformin', dosage: '500 mg' }],
          streakDays: 0,
        },
      ]);
    });

    // calcAdherenceStreak walks day by day, so resolving it per dose — or for a patient
    // with nothing due — would multiply the query count for no added information.
    it('computes the streak once per patient, not once per due dose', async () => {
      patientRepo.find.mockResolvedValue([mockPatient]);
      medicationRepo.find.mockResolvedValue([
        { ...mockMedication, id: 'med-1', scheduleTimes: ['8:00 AM'] },
        { ...mockMedication, id: 'med-2', name: 'Lisinopril', scheduleTimes: ['8:00 AM'] },
      ]);
      userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);
      doseLogRepo.count.mockResolvedValue(0);

      const targets = await service.findDueReminderTargets(new Date('2026-07-17T07:00:00.000Z'));

      // Grouped: two medications sharing 8:00 AM are one email, so there is one target
      // and the streak on it was resolved once.
      expect(targets).toHaveLength(1);
      expect(targets[0].medications).toHaveLength(2);
      // One streak computation costs 2 counts here — isDayFullyTaken short-circuits on
      // a zero total, then the look-back loop breaks on the first empty day. Resolving
      // it per dose instead of per patient would double that, and keep doubling as the
      // patient adds medications.
      expect(doseLogRepo.count).toHaveBeenCalledTimes(2);
    });

    it('does not compute a streak at all when the patient has nothing due', async () => {
      patientRepo.find.mockResolvedValue([mockPatient]);
      medicationRepo.find.mockResolvedValue([{ ...mockMedication, scheduleTimes: ['11:00 PM'] }]);
      userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);

      const targets = await service.findDueReminderTargets(new Date('2026-07-17T07:00:00.000Z'));

      expect(targets).toEqual([]);
      expect(doseLogRepo.count).not.toHaveBeenCalled();
    });

    it('returns nothing when no patients have reminders enabled', async () => {
      patientRepo.find.mockResolvedValue([]);
      const targets = await service.findDueReminderTargets(new Date());
      expect(targets).toEqual([]);
    });

    // Dose times are free-form. Before the window, matching was an exact lookup
    // against four fixed slots, so any other time NEVER produced a reminder.
    describe('free-form dose times', () => {
      /** One reminder-enabled patient in `timezone` with a single dose at `time`. */
      function setup(time: string, timezone = 'Africa/Lagos') {
        patientRepo.find.mockResolvedValue([{ ...mockPatient, timezone }]);
        medicationRepo.find.mockResolvedValue([{ ...mockMedication, scheduleTimes: [time] }]);
        userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);
      }

      /** Lagos is UTC+1, so 09:00 local is 08:00 UTC. */
      function lagosTick(hhmm: string): Date {
        const [h, m] = hhmm.split(':').map(Number);
        return new Date(Date.UTC(2026, 6, 17, h - 1, m, 0));
      }

      it('reminds a 9:15 AM dose 30 minutes ahead, on the 8:45 tick', async () => {
        setup('9:15 AM');
        const targets = await service.findDueReminderTargets(lagosTick('08:45'));
        expect(targets).toHaveLength(1);
        expect(targets[0].lead).toBe(MedicationReminderLead.THIRTY_MINUTES);
        expect(targets[0].scheduledTime).toBe('9:15 AM');
      });

      it('reminds the same dose again at its own moment, on the 9:15 tick', async () => {
        setup('9:15 AM');
        const targets = await service.findDueReminderTargets(lagosTick('09:15'));
        expect(targets).toHaveLength(1);
        expect(targets[0].lead).toBe(MedicationReminderLead.AT_TIME);
      });

      // Exactly-once per lead: neither lead may fire on a tick between the two.
      it('sends nothing on a tick that matches no lead', async () => {
        setup('9:15 AM');
        expect(await service.findDueReminderTargets(lagosTick('09:00'))).toEqual([]);
        expect(await service.findDueReminderTargets(lagosTick('09:30'))).toEqual([]);
      });

      // The property that matters: full-day coverage with no gaps and no repeats —
      // every dose fires exactly once per lead, and never twice for the same lead.
      it('fires every dose exactly once per lead across a full day of 5-minute ticks', async () => {
        const times = ['12:05 AM', '6:45 AM', '9:15 AM', '1:55 PM', '8:00 PM', '11:30 PM'];
        patientRepo.find.mockResolvedValue([mockPatient]);
        medicationRepo.find.mockResolvedValue([{ ...mockMedication, scheduleTimes: times }]);
        userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);

        const fired: string[] = [];
        for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
          const tick = lagosTick(
            `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          );
          const targets = await service.findDueReminderTargets(tick);
          fired.push(...targets.map((t) => `${t.scheduledTime}|${t.lead}`));
        }

        const expected = times.flatMap((t) => [
          `${t}|${MedicationReminderLead.THIRTY_MINUTES}`,
          `${t}|${MedicationReminderLead.AT_TIME}`,
        ]);
        expect(fired.sort()).toEqual(expected.sort());
      });

      // A 45-minute offset never aligns with the tick, which is why the window is
      // anchored to the patient's local time rather than to UTC.
      it('still reminds a patient in a :45-offset timezone', async () => {
        setup('9:15 AM', 'Asia/Kathmandu'); // UTC+5:45
        // 09:15 Kathmandu == 03:30 UTC, the dose's own moment.
        const targets = await service.findDueReminderTargets(new Date('2026-07-17T03:30:00.000Z'));
        expect(targets).toHaveLength(1);
        expect(targets[0].lead).toBe(MedicationReminderLead.AT_TIME);
      });

      it('ignores a dose time it cannot parse instead of throwing', async () => {
        setup('sometime in the morning');
        await expect(service.findDueReminderTargets(lagosTick('09:00'))).resolves.toEqual([]);
      });

      describe('grouping', () => {
        /** Three medications for one patient, at the slots given. */
        function setupMany(times: string[][]) {
          patientRepo.find.mockResolvedValue([mockPatient]);
          medicationRepo.find.mockResolvedValue(
            times.map((scheduleTimes, i) => ({
              ...mockMedication,
              id: `med-${i}`,
              name: `Drug${i}`,
              dosage: `${i + 1}mg`,
              scheduleTimes,
            })),
          );
          userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);
        }

        // The reason grouping exists: this used to be three separate emails, and with
        // two leads it would have been six a day for one slot.
        it('folds every medication in a slot into one target', async () => {
          setupMany([['9:15 AM'], ['9:15 AM'], ['9:15 AM']]);

          const targets = await service.findDueReminderTargets(lagosTick('09:15'));

          expect(targets).toHaveLength(1);
          expect(targets[0].medications).toEqual([
            { name: 'Drug0', dosage: '1mg' },
            { name: 'Drug1', dosage: '2mg' },
            { name: 'Drug2', dosage: '3mg' },
          ]);
        });

        it('keeps separate slots in separate targets', async () => {
          setupMany([['9:15 AM'], ['9:20 AM']]);

          const at915 = await service.findDueReminderTargets(lagosTick('09:15'));
          const at920 = await service.findDueReminderTargets(lagosTick('09:20'));

          expect(at915[0].medications).toEqual([{ name: 'Drug0', dosage: '1mg' }]);
          expect(at920[0].medications).toEqual([{ name: 'Drug1', dosage: '2mg' }]);
        });

        // Two labels can name the same moment; the slot is keyed by the moment, so
        // they share one email rather than producing two.
        it('merges a weekday-prefixed label with a plain one at the same moment', async () => {
          setupMany([['9:15 AM'], ['Friday · 9:15 AM']]); // 2026-07-17 is a Friday

          const targets = await service.findDueReminderTargets(lagosTick('09:15'));

          expect(targets).toHaveLength(1);
          expect(targets[0].medications).toHaveLength(2);
          expect(targets[0].scheduledTime).toBe('9:15 AM');
        });
      });

      describe('already-resolved doses', () => {
        function setupTwo() {
          patientRepo.find.mockResolvedValue([mockPatient]);
          medicationRepo.find.mockResolvedValue([
            { ...mockMedication, id: 'med-taken', name: 'Taken', scheduleTimes: ['9:15 AM'] },
            { ...mockMedication, id: 'med-open', name: 'Open', scheduleTimes: ['9:15 AM'] },
          ]);
          userRepo.find.mockResolvedValue([{ id: USER_ID, email: 'patient@example.com' }]);
        }

        // Telling someone to take a pill they took 20 minutes ago undermines the
        // reminders and risks a double dose.
        it.each([DoseStatus.TAKEN, DoseStatus.SKIPPED])(
          'drops a dose already marked %s',
          async (status) => {
            setupTwo();
            doseLogRepo.find.mockResolvedValue([
              {
                medicationId: 'med-taken',
                doseDate: '2026-07-17',
                scheduledTime: '9:15 AM',
                status,
              },
            ]);

            const targets = await service.findDueReminderTargets(lagosTick('09:15'));

            expect(targets).toHaveLength(1);
            expect(targets[0].medications).toEqual([{ name: 'Open', dosage: '500 mg' }]);
          },
        );

        // A deferred dose still wants its reminder — that is what deferring means — and
        // one with no log row at all has simply not been touched, since rows are
        // written lazily. Both are excluded by the query rather than in JS, so this
        // asserts the filter itself.
        it('only treats TAKEN and SKIPPED as resolved', async () => {
          setupTwo();

          await service.findDueReminderTargets(lagosTick('09:15'));

          expect(doseLogRepo.find).toHaveBeenCalledWith({
            where: expect.objectContaining({
              status: In([DoseStatus.TAKEN, DoseStatus.SKIPPED]),
            }),
          });
        });

        it('sends no email at all when every medication in the slot is resolved', async () => {
          setupTwo();
          doseLogRepo.find.mockResolvedValue([
            {
              medicationId: 'med-taken',
              doseDate: '2026-07-17',
              scheduledTime: '9:15 AM',
              status: DoseStatus.TAKEN,
            },
            {
              medicationId: 'med-open',
              doseDate: '2026-07-17',
              scheduledTime: '9:15 AM',
              status: DoseStatus.TAKEN,
            },
          ]);

          expect(await service.findDueReminderTargets(lagosTick('09:15'))).toEqual([]);
        });

        it('checks the dose log once for the whole tick, not once per dose', async () => {
          setupTwo();

          await service.findDueReminderTargets(lagosTick('09:15'));

          expect(doseLogRepo.find).toHaveBeenCalledTimes(1);
        });
      });

      // The 30-minute lead crosses midnight for an early dose. Without wrap-aware
      // arithmetic this reminder could never fire at all.
      describe('doses either side of midnight', () => {
        it('reminds a 12:10 AM dose at 11:40 PM the evening before', async () => {
          setup('12:10 AM');

          const targets = await service.findDueReminderTargets(lagosTick('23:40'));

          expect(targets).toHaveLength(1);
          expect(targets[0].lead).toBe(MedicationReminderLead.THIRTY_MINUTES);
          expect(targets[0].scheduledTime).toBe('12:10 AM');
        });

        it('reads the dose log against tomorrow for a wrapped reminder', async () => {
          setup('12:10 AM');
          // 2026-07-17 at 23:40 local, so the dose belongs to the 18th.
          doseLogRepo.find.mockResolvedValue([
            {
              medicationId: MEDICATION_ID,
              doseDate: '2026-07-18',
              scheduledTime: '12:10 AM',
              status: DoseStatus.TAKEN,
            },
          ]);

          expect(await service.findDueReminderTargets(lagosTick('23:40'))).toEqual([]);
        });

        // The weekday must be tested against the day the dose lands on, not today.
        it('reminds a Saturday dose from Friday evening', async () => {
          setup('Saturday · 12:10 AM'); // 2026-07-17 is a Friday

          const targets = await service.findDueReminderTargets(lagosTick('23:40'));

          expect(targets).toHaveLength(1);
        });

        it('does not remind a Friday-only dose from Friday evening', async () => {
          setup('Friday · 12:10 AM');

          expect(await service.findDueReminderTargets(lagosTick('23:40'))).toEqual([]);
        });
      });

      describe('weekly doses', () => {
        // 2026-07-17 is a Friday.
        it('reminds on the named weekday', async () => {
          setup('Friday · 9:15 AM');
          const targets = await service.findDueReminderTargets(lagosTick('09:15'));
          expect(targets).toHaveLength(1);
          // Normalised for display: the email arrives on the day in question, so the
          // weekday prefix would be noise — and one slot can gather several labels.
          expect(targets[0].scheduledTime).toBe('9:15 AM');
        });

        it('does not remind on any other weekday', async () => {
          setup('Monday · 9:15 AM');
          const targets = await service.findDueReminderTargets(lagosTick('09:15'));
          expect(targets).toEqual([]);
        });
      });
    });
  });

  describe('dose log creation', () => {
    /** ensureDoseLogsForDate runs inside getSchedule; inspect what it inserts. */
    function insertedRows(): Array<{ scheduledTime: string }> {
      const qb = doseLogRepo.createQueryBuilder.mock.results[0]?.value;
      return qb?.values.mock.calls[0]?.[0] ?? [];
    }

    it('creates a log for a weekly dose only on its own weekday', async () => {
      medicationRepo.find.mockResolvedValue([
        { ...mockMedication, frequency: 'Weekly', scheduleTimes: ['Monday · 8:00 AM'] },
      ]);

      // 2026-07-20 is a Monday.
      await service.getSchedule(USER_ID, '2026-07-20');
      expect(insertedRows().map((r) => r.scheduledTime)).toEqual(['Monday · 8:00 AM']);
    });

    // Previously a weekly medication was logged every day, so it looked due daily.
    it('creates no log for a weekly dose on a different weekday', async () => {
      medicationRepo.find.mockResolvedValue([
        { ...mockMedication, frequency: 'Weekly', scheduleTimes: ['Monday · 8:00 AM'] },
      ]);

      // 2026-07-21 is a Tuesday.
      const result = await service.getSchedule(USER_ID, '2026-07-21');
      expect(result.slots).toEqual([]);
      expect(doseLogRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('creates a log for every daily dose time', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);

      await service.getSchedule(USER_ID, '2026-07-21');
      expect(insertedRows().map((r) => r.scheduledTime)).toEqual(['8:00 AM', '8:00 PM']);
    });

    // Rows are created lazily, so a dose the patient never looked at is born hours
    // after its slot and the sweep never saw it — it did not exist. Deciding the
    // status at insert time is what stops a first read at 8 PM showing the 8 AM
    // dose as upcoming until the next tick.
    it('creates an already-elapsed dose as MISSED and a still-actionable one as PENDING', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T19:00:00.000Z')); // 8:00 PM in Africa/Lagos
      medicationRepo.find.mockResolvedValue([mockMedication]);

      await service.getSchedule(USER_ID);

      expect(
        (insertedRows() as Array<{ scheduledTime: string; status: DoseStatus }>).map((r) => [
          r.scheduledTime,
          r.status,
        ]),
      ).toEqual([
        ['8:00 AM', DoseStatus.MISSED],
        ['8:00 PM', DoseStatus.PENDING],
      ]);

      jest.useRealTimers();
    });
  });

  describe('markOverdueDosesMissed', () => {
    /** Africa/Lagos is UTC+1 — the same zone mockPatient carries. */
    const LAGOS_PATIENT = { id: PATIENT_ID, userId: USER_ID, timezone: 'Africa/Lagos' };

    function doseLog(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'log-1',
        medicationId: MEDICATION_ID,
        patientId: PATIENT_ID,
        doseDate: '2026-07-22',
        scheduledTime: '8:00 AM',
        status: DoseStatus.PENDING,
        ...overrides,
      };
    }

    /** Wires the two query builders the sweep asks for, in the order it asks. */
    function arrangeSweep(rows: unknown[], affected = rows.length) {
      const selectQb = makeSelectQueryBuilderMock(rows);
      const updateQb = makeSweepUpdateQueryBuilderMock(affected);
      doseLogRepo.createQueryBuilder.mockReturnValueOnce(selectQb).mockReturnValueOnce(updateQb);
      patientRepo.find.mockResolvedValue([LAGOS_PATIENT]);
      return { selectQb, updateQb };
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks a PENDING dose missed once the 60 minute grace has elapsed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T08:30:00.000Z')); // 9:30 AM local — 90 min late
      const { updateQb } = arrangeSweep([doseLog()]);

      const marked = await service.markOverdueDosesMissed();

      expect(marked).toBe(1);
      expect(updateQb.set).toHaveBeenCalledWith({ status: DoseStatus.MISSED });
      expect(updateQb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['log-1'] });
    });

    it('leaves a PENDING dose alone while it is still inside its grace', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T07:30:00.000Z')); // 8:30 AM local — 30 min late
      const { updateQb } = arrangeSweep([doseLog()]);

      expect(await service.markOverdueDosesMissed()).toBe(0);
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    // A LATER dose was deferred deliberately, so it gets the longer grace.
    it('leaves a LATER dose alone at 90 minutes but marks it missed past 120', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T08:30:00.000Z')); // 9:30 AM local — 90 min late
      const early = arrangeSweep([doseLog({ status: DoseStatus.LATER })]);
      expect(await service.markOverdueDosesMissed()).toBe(0);
      expect(early.updateQb.execute).not.toHaveBeenCalled();

      doseLogRepo.createQueryBuilder.mockReset();
      jest.setSystemTime(new Date('2026-07-22T09:30:00.000Z')); // 10:30 AM local — 150 min late
      const late = arrangeSweep([doseLog({ status: DoseStatus.LATER })]);
      expect(await service.markOverdueDosesMissed()).toBe(1);
      expect(late.updateQb.execute).toHaveBeenCalled();
    });

    // Same rule the rest of the service follows: an unreadable label is skipped, never
    // treated as an error — and here, never as evidence the patient missed a dose.
    it('never marks a dose whose time label cannot be parsed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T20:00:00.000Z'));
      const { updateQb } = arrangeSweep([doseLog({ scheduledTime: 'whenever' })]);

      expect(await service.markOverdueDosesMissed()).toBe(0);
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    // The day rolled over in the patient's zone but only 31 minutes have passed.
    it('measures grace across midnight rather than treating yesterday as a full day late', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T23:30:00.000Z')); // 00:30 on the 23rd, local
      const { updateQb } = arrangeSweep([doseLog({ scheduledTime: '11:59 PM' })]);

      expect(await service.markOverdueDosesMissed()).toBe(0);
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    it('returns 0 without touching the database when nothing is overdue', async () => {
      arrangeSweep([]);

      expect(await service.markOverdueDosesMissed()).toBe(0);
      expect(patientRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('counts missed doses and stops a fully-missed day counting toward the streak', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.count.mockImplementation(({ where }: { where: Record<string, any> }) => {
        const status = where.status;
        // No status filter — "how many doses did this day have at all".
        if (!status) return Promise.resolve(1);
        if (status === DoseStatus.MISSED) return Promise.resolve(1);
        // The non-taken set inside isDayFullyTaken; MISSED has to be part of it or a
        // day the patient missed entirely would read as a perfect day.
        if (Array.isArray(status.value) && status.value.includes(DoseStatus.MISSED)) {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      const stats = await service.getStats(USER_ID);

      expect(stats.missedToday).toBe(1);
      expect(stats.takenToday).toBe(0);
      expect(stats.adherenceStreakDays).toBe(0);
    });
  });

  describe('schedule slot ordering', () => {
    // localeCompare ordered these '10:00 PM' < '2:00 PM' < '8:00 AM'.
    it('orders slots chronologically, not lexicographically', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue(
        ['10:00 PM', '2:00 PM', '8:00 AM', '9:15 AM'].map((scheduledTime, i) => ({
          id: `log-${i}`,
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-21',
          scheduledTime,
          status: DoseStatus.PENDING,
        })),
      );

      const result = await service.getSchedule(USER_ID, '2026-07-21');

      expect(result.slots.map((s) => s.time)).toEqual([
        '8:00 AM',
        '9:15 AM',
        '2:00 PM',
        '10:00 PM',
      ]);
    });

    it('sorts an unparseable slot last rather than dropping it', async () => {
      medicationRepo.find.mockResolvedValue([mockMedication]);
      doseLogRepo.find.mockResolvedValue(
        ['whenever', '8:00 AM'].map((scheduledTime, i) => ({
          id: `log-${i}`,
          medicationId: MEDICATION_ID,
          patientId: PATIENT_ID,
          doseDate: '2026-07-21',
          scheduledTime,
          status: DoseStatus.PENDING,
        })),
      );

      const result = await service.getSchedule(USER_ID, '2026-07-21');

      expect(result.slots.map((s) => s.time)).toEqual(['8:00 AM', 'whenever']);
    });
  });
});
