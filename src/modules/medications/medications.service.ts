import { ulid } from 'ulid';

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuditAction, DoseStatus, NotificationType } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { Medication } from './entities/medication.entity';
import { MedicationDoseLog } from './entities/medication-dose-log.entity';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { LogDoseDto } from './dto/log-dose.dto';
import { RegisterRemindersDto } from './dto/register-reminders.dto';
import { RefillUrgency } from './interfaces/refill-urgency.type';
import { ScheduledDoseResult } from './interfaces/scheduled-dose-result.interface';
import { ScheduleSlotResult } from './interfaces/schedule-slot-result.interface';
import { RefillAlertResult } from './interfaces/refill-alert-result.interface';
import { MedicationStats } from './interfaces/medication-stats.interface';
import { ReminderTarget } from './interfaces/reminder-target.interface';
import { RefillAlertTarget } from './interfaces/refill-alert-target.interface';

const URGENT_THRESHOLD_DAYS = 7;
const UPCOMING_THRESHOLD_DAYS = 14;
const MAX_STREAK_LOOKBACK_DAYS = 365;
const DUE_NOW_WINDOW_MINUTES = 15;

// The frontend only ever offers these 4 fixed dose-time slots — mapped to 24h
// local time so the reminder tick can match against Intl-derived HH:mm.
const SLOT_TIME_LABELS: Record<string, string> = {
  '08:00': '8:00 AM',
  '14:00': '2:00 PM',
  '20:00': '8:00 PM',
  '22:00': '10:00 PM',
};

@Injectable()
export class MedicationsService {
  constructor(
    @InjectRepository(Medication)
    private readonly medicationRepo: Repository<Medication>,

    @InjectRepository(MedicationDoseLog)
    private readonly doseLogRepo: Repository<MedicationDoseLog>,

    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly patientsService: PatientsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listMedications(userId: string): Promise<Medication[]> {
    const patient = await this.patientsService.getMyProfile(userId);
    return this.medicationRepo.find({ where: { patientId: patient.id }, order: { id: 'ASC' } });
  }

  async createMedication(userId: string, dto: CreateMedicationDto): Promise<Medication> {
    const patient = await this.patientsService.getMyProfile(userId);

    const medication = this.medicationRepo.create({
      patientId: patient.id,
      name: dto.name,
      dosage: dto.dosage,
      condition: dto.condition,
      frequency: dto.frequency,
      scheduleTimes: dto.scheduleTimes,
      prescriber: dto.prescriber,
      specialty: dto.specialty,
      pillsTotal: dto.pillsTotal,
      pillsRemaining: dto.pillsTotal,
      refillDate: dto.refillDate,
      rxnormCode: dto.rxnormCode,
      notes: dto.notes,
    });
    const saved = await this.medicationRepo.save(medication);

    await this.syncMedicationListSummary(patient.id);

    return saved;
  }

  async updateMedication(userId: string, id: string, dto: UpdateMedicationDto): Promise<Medication> {
    const medication = await this.getOwnedMedication(userId, id);

    const updates: Partial<Medication> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.dosage !== undefined) updates.dosage = dto.dosage;
    if (dto.condition !== undefined) updates.condition = dto.condition;
    if (dto.frequency !== undefined) updates.frequency = dto.frequency;
    if (dto.scheduleTimes !== undefined) updates.scheduleTimes = dto.scheduleTimes;
    if (dto.prescriber !== undefined) updates.prescriber = dto.prescriber;
    if (dto.specialty !== undefined) updates.specialty = dto.specialty;
    if (dto.pillsTotal !== undefined) updates.pillsTotal = dto.pillsTotal;
    if (dto.pillsRemaining !== undefined) updates.pillsRemaining = dto.pillsRemaining;
    if (dto.refillDate !== undefined) updates.refillDate = dto.refillDate;
    if (dto.rxnormCode !== undefined) updates.rxnormCode = dto.rxnormCode;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    await this.medicationRepo.update({ id: medication.id }, updates);

    if (
      dto.name !== undefined ||
      dto.dosage !== undefined ||
      dto.frequency !== undefined ||
      dto.rxnormCode !== undefined
    ) {
      await this.syncMedicationListSummary(medication.patientId);
    }

    return this.getOwnedMedication(userId, id);
  }

  async deleteMedication(userId: string, id: string): Promise<{ id: string; deletedAt: Date }> {
    const medication = await this.getOwnedMedication(userId, id);
    await this.medicationRepo.softDelete({ id: medication.id });
    await this.syncMedicationListSummary(medication.patientId);

    const deleted = await this.medicationRepo.findOne({ where: { id: medication.id }, withDeleted: true });
    return { id: medication.id, deletedAt: deleted!.deletedAt! };
  }

  async getSchedule(userId: string, date?: string): Promise<{ date: string; slots: ScheduleSlotResult[] }> {
    const patient = await this.patientsService.getMyProfile(userId);
    const targetDate = date ?? this.todayIso();

    const medications = await this.medicationRepo.find({ where: { patientId: patient.id } });
    await this.ensureDoseLogsForDate(patient.id, medications, targetDate);

    const logs = await this.doseLogRepo.find({ where: { patientId: patient.id, doseDate: targetDate } });
    const medById = new Map(medications.map((m) => [m.id, m]));
    const nowLocal = this.nowInTimezone(new Date(), patient.timezone ?? 'UTC');

    const slots = new Map<string, ScheduleSlotResult>();
    for (const log of logs) {
      const med = medById.get(log.medicationId);
      if (!med) continue;

      if (!slots.has(log.scheduledTime)) {
        slots.set(log.scheduledTime, { time: log.scheduledTime, doses: [] });
      }
      slots.get(log.scheduledTime)!.doses.push({
        doseLogId: log.id,
        medicationId: med.id,
        medName: med.name,
        dosage: med.dosage,
        note: med.notes,
        status: this.resolveDisplayStatus(log.status, log.scheduledTime, targetDate, nowLocal),
      });
    }

    return { date: targetDate, slots: [...slots.values()].sort((a, b) => a.time.localeCompare(b.time)) };
  }

  async logDose(userId: string, medicationId: string, dto: LogDoseDto): Promise<MedicationDoseLog> {
    const medication = await this.getOwnedMedication(userId, medicationId);
    const doseDate = dto.doseDate ?? this.todayIso();

    let log = await this.doseLogRepo.findOne({
      where: { medicationId: medication.id, doseDate, scheduledTime: dto.scheduledTime },
    });

    const wasTaken = log?.status === DoseStatus.TAKEN;

    if (!log) {
      log = this.doseLogRepo.create({
        medicationId: medication.id,
        patientId: medication.patientId,
        doseDate,
        scheduledTime: dto.scheduledTime,
        status: dto.status,
      });
    } else {
      log.status = dto.status;
    }

    if (dto.status === DoseStatus.TAKEN) {
      log.takenAt = new Date();
    }

    const saved = await this.doseLogRepo.save(log);

    if (dto.status === DoseStatus.TAKEN && !wasTaken) {
      await this.medicationRepo
        .createQueryBuilder()
        .update(Medication)
        .set({ pillsRemaining: () => 'GREATEST(pills_remaining - 1, 0)' })
        .where('id = :id', { id: medication.id })
        .execute();
    }

    return saved;
  }

  async getRefillAlerts(userId: string): Promise<{ alerts: RefillAlertResult[]; okCount: number }> {
    const patient = await this.patientsService.getMyProfile(userId);
    const medications = await this.medicationRepo.find({ where: { patientId: patient.id } });

    const alerts: RefillAlertResult[] = [];
    let okCount = 0;

    for (const med of medications) {
      const urgency = this.calcUrgency(med.refillDate);
      if (urgency === 'ok') {
        okCount += 1;
        continue;
      }
      alerts.push({
        medicationId: med.id,
        name: `${med.name} ${med.dosage}`,
        pillsLeft: med.pillsRemaining,
        refillDateISO: med.refillDate,
        urgency,
      });
    }

    return { alerts, okCount };
  }

  async requestRefill(userId: string, medicationId: string): Promise<{ requested: true }> {
    const medication = await this.getOwnedMedication(userId, medicationId);

    await this.auditService.log({
      actorId: userId,
      action: AuditAction.MEDICATION_REFILL_REQUESTED,
      resourceId: medication.id,
      resourceType: 'medication',
      metadata: { medicationName: medication.name },
    });

    await this.notificationsService.createOne(userId, NotificationType.REFILL_ALERT, {
      medicationId: medication.id,
      medicationName: medication.name,
      source: 'patient_request',
    });

    return { requested: true };
  }

  async getStats(userId: string): Promise<MedicationStats> {
    const patient = await this.patientsService.getMyProfile(userId);
    const today = this.todayIso();

    const activeMeds = await this.medicationRepo.count({ where: { patientId: patient.id } });

    // Ensures today's dose-log rows exist so the counts below are accurate
    await this.getSchedule(userId, today);

    const takenToday = await this.doseLogRepo.count({
      where: { patientId: patient.id, doseDate: today, status: DoseStatus.TAKEN },
    });

    const dueToday = await this.doseLogRepo.count({
      where: { patientId: patient.id, doseDate: today, status: In([DoseStatus.PENDING, DoseStatus.LATER]) },
    });

    const adherenceStreakDays = await this.calcAdherenceStreak(patient.id);

    return { activeMeds, takenToday, dueToday, adherenceStreakDays };
  }

  async registerReminders(userId: string, dto: RegisterRemindersDto): Promise<{ registered: true }> {
    const patient = await this.patientsService.getMyProfile(userId);
    await this.patientRepo.update(
      { id: patient.id },
      { timezone: dto.timezone, medicationRemindersEnabled: true },
    );
    return { registered: true };
  }

  async unregisterReminders(userId: string): Promise<{ registered: false }> {
    const patient = await this.patientsService.getMyProfile(userId);
    await this.patientRepo.update({ id: patient.id }, { medicationRemindersEnabled: false });
    return { registered: false };
  }

  // Called by medication-reminder-tick.processor.ts. Scoped to reminder-opted-in
  // patients only, then compared in-memory against a bounded, already-filtered
  // batch — not a substitute for SQL-side scoping of the wider patients table.
  async findDueReminderTargets(now: Date = new Date()): Promise<ReminderTarget[]> {
    const patients = await this.patientRepo.find({ where: { medicationRemindersEnabled: true } });
    if (patients.length === 0) return [];

    const patientIds = patients.map((p) => p.id);
    const medications = await this.medicationRepo.find({ where: { patientId: In(patientIds) } });
    const medsByPatientId = new Map<string, Medication[]>();
    for (const med of medications) {
      const list = medsByPatientId.get(med.patientId) ?? [];
      list.push(med);
      medsByPatientId.set(med.patientId, list);
    }

    const userIds = patients.map((p) => p.userId);
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

    const targets: ReminderTarget[] = [];
    for (const patient of patients) {
      const email = emailByUserId.get(patient.userId);
      if (!email) continue;

      const slotLabel = this.currentSlotLabel(now, patient.timezone ?? 'UTC');
      if (!slotLabel) continue;

      for (const med of medsByPatientId.get(patient.id) ?? []) {
        if (med.scheduleTimes.includes(slotLabel)) {
          targets.push({ email, medicationName: med.name, dosage: med.dosage, scheduledTime: slotLabel });
        }
      }
    }

    return targets;
  }

  // Called by medication-refill-check.processor.ts (daily).
  async findMedicationsNeedingRefillAlert(): Promise<RefillAlertTarget[]> {
    const medications = await this.medicationRepo.find();
    if (medications.length === 0) return [];

    const patientIds = [...new Set(medications.map((m) => m.patientId))];
    const patients = await this.patientRepo.find({ where: { id: In(patientIds) } });
    const userIdByPatientId = new Map(patients.map((p) => [p.id, p.userId]));

    const targets: RefillAlertTarget[] = [];
    for (const med of medications) {
      const urgency = this.calcUrgency(med.refillDate);
      if (urgency === 'ok') continue;

      const userId = userIdByPatientId.get(med.patientId);
      if (!userId) continue;

      targets.push({ userId, medicationId: med.id, medicationName: med.name, urgency });
    }

    return targets;
  }

  private currentSlotLabel(now: Date, timezone: string): string | undefined {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const hour = parts.find((p) => p.type === 'hour')?.value;
      const minute = parts.find((p) => p.type === 'minute')?.value;
      if (!hour || !minute) return undefined;
      return SLOT_TIME_LABELS[`${hour}:${minute}`];
    } catch {
      return undefined;
    }
  }

  private nowInTimezone(now: Date, timezone: string): { dateIso: string; minutes: number } | undefined {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      const year = get('year');
      const month = get('month');
      const day = get('day');
      const hour = get('hour');
      const minute = get('minute');
      if (!year || !month || !day || !hour || !minute) return undefined;
      return { dateIso: `${year}-${month}-${day}`, minutes: Number(hour) * 60 + Number(minute) };
    } catch {
      return undefined;
    }
  }

  // Overlays DUE_NOW onto a PENDING dose when the patient's local time is
  // within DUE_NOW_WINDOW_MINUTES of the scheduled slot. Only applies to the
  // day being viewed as "today" in the patient's own timezone. This is a
  // read-time overlay only — the persisted log row stays PENDING, since
  // LogDoseDto never accepts DUE_NOW as a status a patient can write.
  private resolveDisplayStatus(
    status: DoseStatus,
    scheduledTime: string,
    doseDate: string,
    nowLocal: { dateIso: string; minutes: number } | undefined,
  ): DoseStatus {
    if (status !== DoseStatus.PENDING || !nowLocal || nowLocal.dateIso !== doseDate) return status;

    const scheduledMinutes = this.parseTimeLabelToMinutes(scheduledTime);
    if (scheduledMinutes === undefined) return status;

    return Math.abs(nowLocal.minutes - scheduledMinutes) <= DUE_NOW_WINDOW_MINUTES ? DoseStatus.DUE_NOW : status;
  }

  private parseTimeLabelToMinutes(label: string): number | undefined {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
    if (!match) return undefined;

    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
    return hour * 60 + Number(match[2]);
  }

  private async getOwnedMedication(userId: string, id: string): Promise<Medication> {
    const patient = await this.patientsService.getMyProfile(userId);
    const medication = await this.medicationRepo.findOne({ where: { id, patientId: patient.id } });
    if (!medication) throw new NotFoundException(`Medication ${id} not found`);
    return medication;
  }

  private async ensureDoseLogsForDate(patientId: string, medications: Medication[], date: string): Promise<void> {
    const rows = medications.flatMap((med) =>
      med.scheduleTimes.map((time) => ({
        id: ulid(),
        medicationId: med.id,
        patientId,
        doseDate: date,
        scheduledTime: time,
        status: DoseStatus.PENDING,
      })),
    );
    if (rows.length === 0) return;

    await this.doseLogRepo.createQueryBuilder().insert().values(rows).orIgnore().execute();
  }

  private async syncMedicationListSummary(patientId: string): Promise<void> {
    const medications = await this.medicationRepo.find({ where: { patientId } });
    const summary = medications.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      ...(m.rxnormCode ? { rxnormCode: m.rxnormCode } : {}),
    }));
    await this.patientRepo.update({ id: patientId }, { medicationList: summary });
  }

  private calcUrgency(refillDateISO: string): RefillUrgency {
    const days = Math.floor((new Date(refillDateISO).getTime() - Date.now()) / 86_400_000);
    if (days <= URGENT_THRESHOLD_DAYS) return 'urgent';
    if (days <= UPCOMING_THRESHOLD_DAYS) return 'upcoming';
    return 'ok';
  }

  // Streak = consecutive fully-completed days ending yesterday, plus today if
  // today is already fully completed. A day with no scheduled doses breaks the streak.
  private async calcAdherenceStreak(patientId: string): Promise<number> {
    let streak = 0;
    const cursor = new Date();

    const todayIso = cursor.toISOString().slice(0, 10);
    if (await this.isDayFullyTaken(patientId, todayIso)) {
      streak += 1;
    }
    cursor.setDate(cursor.getDate() - 1);

    for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
      const dateIso = cursor.toISOString().slice(0, 10);
      const total = await this.doseLogRepo.count({ where: { patientId, doseDate: dateIso } });
      if (total === 0) break;

      if (!(await this.isDayFullyTaken(patientId, dateIso))) break;

      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  private async isDayFullyTaken(patientId: string, dateIso: string): Promise<boolean> {
    const total = await this.doseLogRepo.count({ where: { patientId, doseDate: dateIso } });
    if (total === 0) return false;

    const nonTaken = await this.doseLogRepo.count({
      where: {
        patientId,
        doseDate: dateIso,
        status: In([DoseStatus.PENDING, DoseStatus.LATER, DoseStatus.SKIPPED]),
      },
    });
    return nonTaken === 0;
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
