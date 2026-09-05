import { ulid } from 'ulid';

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  AuditAction,
  DoseStatus,
  MedicationReminderLead,
  NotificationType,
} from 'src/common/enums';
import { MEDICATION_REMINDER_LEAD_MINUTES } from 'src/common/constants/medication-reminder-leads';
import { LocalClock } from 'src/common/interfaces/local-clock.interface';
import { ParsedTimeLabel } from 'src/common/interfaces/parsed-time-label.interface';
import { firstName } from 'src/common/utils/first-name.util';
import {
  appliesOnDate,
  formatMinutesAsLabel,
  minutesUntilNextDailyOccurrence,
  minutesUntilScheduled,
  nowInTimezone,
  parseTimeLabel,
} from 'src/common/utils/time-label.util';
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
import { ReminderCandidate } from './interfaces/reminder-candidate.interface';
import { ReminderTarget } from './interfaces/reminder-target.interface';
import { RefillAlertTarget } from './interfaces/refill-alert-target.interface';

const URGENT_THRESHOLD_DAYS = 7;
const UPCOMING_THRESHOLD_DAYS = 14;
const MAX_STREAK_LOOKBACK_DAYS = 365;
const DUE_NOW_WINDOW_MINUTES = 15;
// Must equal the medication reminder tick interval (app.config.ts) — 5 minutes. This
// is the fallback used when the env var is unset, so a stale value here is not
// harmless: at a 30-minute window against a 5-minute tick, every dose matches on six
// consecutive ticks and the patient gets six copies of the same reminder.
const DEFAULT_REMINDER_WINDOW_MINUTES = 5;
const DEFAULT_DOSE_GRACE_MINUTES = 60;
const DEFAULT_LATER_DOSE_GRACE_MINUTES = 120;

/**
 * Upper bound on rows `markOverdueDosesMissed` touches in one run. The sweep is
 * repeatable, so a backlog larger than this — the first run after deploy, or after
 * the worker has been down — is drained over consecutive ticks rather than loaded
 * into memory at once. Oldest doses are swept first.
 */
const MISSED_SWEEP_BATCH_SIZE = 1000;

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
    private readonly configService: ConfigService,
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

  async updateMedication(
    userId: string,
    id: string,
    dto: UpdateMedicationDto,
  ): Promise<Medication> {
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

    const deleted = await this.medicationRepo.findOne({
      where: { id: medication.id },
      withDeleted: true,
    });
    return { id: medication.id, deletedAt: deleted!.deletedAt! };
  }

  async getSchedule(
    userId: string,
    date?: string,
  ): Promise<{ date: string; slots: ScheduleSlotResult[] }> {
    const patient = await this.patientsService.getMyProfile(userId);
    const targetDate = date ?? this.todayIso();

    const medications = await this.medicationRepo.find({ where: { patientId: patient.id } });
    const nowLocal = this.nowInTimezone(new Date(), patient.timezone ?? 'UTC');
    await this.ensureDoseLogsForDate(patient.id, medications, targetDate, nowLocal);

    const logs = await this.doseLogRepo.find({
      where: { patientId: patient.id, doseDate: targetDate },
    });
    const medById = new Map(medications.map((m) => [m.id, m]));

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

    // Ordered by parsed time, not string: localeCompare put '10:00 PM' before
    // '2:00 PM' before '8:00 AM'. Unparseable labels sort last rather than vanish.
    const byTime = [...slots.values()].sort((a, b) => {
      const aMin = this.parseDoseTime(a.time)?.minutes ?? Number.MAX_SAFE_INTEGER;
      const bMin = this.parseDoseTime(b.time)?.minutes ?? Number.MAX_SAFE_INTEGER;
      return aMin - bMin || a.time.localeCompare(b.time);
    });

    return { date: targetDate, slots: byTime };
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
      where: {
        patientId: patient.id,
        doseDate: today,
        status: In([DoseStatus.PENDING, DoseStatus.LATER]),
      },
    });

    const missedToday = await this.doseLogRepo.count({
      where: { patientId: patient.id, doseDate: today, status: DoseStatus.MISSED },
    });

    const adherenceStreakDays = await this.calcAdherenceStreak(patient.id);

    return { activeMeds, takenToday, dueToday, missedToday, adherenceStreakDays };
  }

  async registerReminders(
    userId: string,
    dto: RegisterRemindersDto,
  ): Promise<{ registered: true }> {
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
  /**
   * The reminder emails due to go out on this tick.
   *
   * Each dose is matched against every entry in MEDICATION_REMINDER_LEAD_MINUTES, so
   * one dose produces one email per lead (30 minutes ahead, then at the dose's own
   * moment). Results are grouped by patient, lead and slot: three medications sharing
   * 8:00 AM are one email, not three.
   */
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

    const windowMinutes = this.reminderWindowMinutes();
    const leads = Object.entries(MEDICATION_REMINDER_LEAD_MINUTES) as Array<
      [MedicationReminderLead, number]
    >;

    // Collected first and filtered second: the already-taken check is one query for the
    // whole tick rather than one per dose, which at a popular slot like 8:00 AM is the
    // difference between a single round trip and hundreds.
    const candidates: ReminderCandidate[] = [];

    for (const patient of patients) {
      const email = emailByUserId.get(patient.userId);
      if (!email) continue;

      // Anchored to the patient's own local time, not to the tick's wall clock:
      // zones offset by 30 or 45 minutes (Asia/Kolkata, Asia/Kathmandu) never line
      // up with the tick, so a window computed from UTC would drift for them.
      const local = this.nowInTimezone(now, patient.timezone ?? 'UTC');
      if (!local) continue;

      for (const med of medsByPatientId.get(patient.id) ?? []) {
        for (const scheduledTime of med.scheduleTimes) {
          const parsed = this.parseDoseTime(scheduledTime);
          if (!parsed) continue;

          // Wrap-aware, and it returns the date the occurrence lands on: at 23:40 a
          // 12:10 AM dose is 30 minutes away and belongs to tomorrow, which is also the
          // date its weekday and its dose log must be read against.
          const next = minutesUntilNextDailyOccurrence(parsed, local);
          if (!next) continue;

          for (const [lead, leadMinutes] of leads) {
            // Half-open [lead, lead + window): each dose is claimed by exactly one tick
            // per lead, so none falls between two ticks and none is reminded twice.
            const due =
              next.minutesUntil >= leadMinutes && next.minutesUntil < leadMinutes + windowMinutes;
            if (!due) continue;

            candidates.push({
              patient,
              email,
              lead,
              slotMinutes: parsed.minutes,
              doseDate: next.dateIso,
              medicationId: med.id,
              // The label as stored, because that is how the dose log is keyed.
              scheduledTime,
              name: med.name,
              dosage: med.dosage,
            });
          }
        }
      }
    }

    if (candidates.length === 0) return [];

    const resolved = await this.findResolvedDoseKeys(candidates);

    return this.groupCandidates(candidates, resolved);
  }

  /**
   * The `medicationId|doseDate|scheduledTime` keys among these candidates that the
   * patient has already dealt with.
   *
   * TAKEN and SKIPPED only. A LATER dose was deliberately deferred, so its reminder is
   * still wanted; a dose with no log row at all has simply not been touched yet, since
   * rows are written lazily.
   */
  private async findResolvedDoseKeys(candidates: ReminderCandidate[]): Promise<Set<string>> {
    const logs = await this.doseLogRepo.find({
      where: {
        medicationId: In([...new Set(candidates.map((c) => c.medicationId))]),
        doseDate: In([...new Set(candidates.map((c) => c.doseDate))]),
        status: In([DoseStatus.TAKEN, DoseStatus.SKIPPED]),
      },
    });

    // The query is a cross product of ids and dates, so match the exact triple here.
    return new Set(logs.map((l) => `${l.medicationId}|${l.doseDate}|${l.scheduledTime}`));
  }

  /** Folds candidates into one target per patient, lead and slot. */
  private async groupCandidates(
    candidates: ReminderCandidate[],
    resolved: Set<string>,
  ): Promise<ReminderTarget[]> {
    const groups = new Map<string, ReminderCandidate[]>();
    for (const candidate of candidates) {
      const key = `${candidate.medicationId}|${candidate.doseDate}|${candidate.scheduledTime}`;
      if (resolved.has(key)) continue;

      const groupKey = `${candidate.patient.id}|${candidate.lead}|${candidate.slotMinutes}`;
      const group = groups.get(groupKey) ?? [];
      group.push(candidate);
      groups.set(groupKey, group);
    }

    // Resolved lazily and once per patient, not per group: the reminder copy quotes the
    // streak, but calcAdherenceStreak walks day by day, so computing it for a patient
    // with nothing due — or once per slot — would multiply the query count for nothing.
    const streakByPatientId = new Map<string, number>();
    const streakFor = async (patientId: string) => {
      const cached = streakByPatientId.get(patientId);
      if (cached !== undefined) return cached;
      const streak = await this.calcAdherenceStreak(patientId);
      streakByPatientId.set(patientId, streak);
      return streak;
    };

    const targets: ReminderTarget[] = [];
    for (const group of groups.values()) {
      const [first] = group;
      targets.push({
        email: first.email,
        firstName: firstName(first.patient.name ?? ''),
        lead: first.lead,
        scheduledTime: formatMinutesAsLabel(first.slotMinutes),
        // Deduped: the same medication can carry the same moment under two labels.
        medications: [
          ...new Map(
            group.map((c) => [`${c.name}|${c.dosage}`, { name: c.name, dosage: c.dosage }]),
          ).values(),
        ],
        streakDays: await streakFor(first.patient.id),
      });
    }

    return targets;
  }

  /** See the COUPLED PAIR note in app.config.ts — must be >= the tick interval. */
  private reminderWindowMinutes(): number {
    const configured = this.configService.get<number>('app.medicationReminderWindowMinutes');
    return configured && configured > 0 ? configured : DEFAULT_REMINDER_WINDOW_MINUTES;
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

  /**
   * Called by medication-missed-sweep.processor.ts. Flips PENDING and LATER dose logs
   * whose grace period has elapsed to MISSED, and returns how many rows changed.
   *
   * Not expressible as a single UPDATE: `scheduled_time` is a free-form label, not a
   * time column, and the grace test is anchored to the patient's own timezone — so the
   * candidate rows have to be read, parsed and filtered in memory, the same way
   * findDueReminderTargets does for reminders.
   */
  async markOverdueDosesMissed(now: Date = new Date()): Promise<number> {
    // dose_date is compared against the DB's CURRENT_DATE (UTC) while the grace test
    // below is patient-local. That mismatch is safe in this direction: it can only
    // over-select by at most a day, and the per-row check rejects anything not
    // genuinely past grace. Oldest first, so a backlog drains in order.
    const candidates = await this.doseLogRepo
      .createQueryBuilder('log')
      .where('log.status IN (:...statuses)', {
        statuses: [DoseStatus.PENDING, DoseStatus.LATER],
      })
      .andWhere('log.dose_date <= CURRENT_DATE')
      .orderBy('log.dose_date', 'ASC')
      .addOrderBy('log.id', 'ASC')
      .take(MISSED_SWEEP_BATCH_SIZE)
      .getMany();

    if (candidates.length === 0) return 0;

    const patientIds = [...new Set(candidates.map((log) => log.patientId))];
    const patients = await this.patientRepo.find({ where: { id: In(patientIds) } });
    const timezoneByPatientId = new Map(patients.map((p) => [p.id, p.timezone ?? 'UTC']));

    // One nowInTimezone call per distinct zone rather than per row — a patient with a
    // week of overdue doses would otherwise re-derive the same local time every time.
    const localByTimezone = new Map<string, { dateIso: string; minutes: number } | undefined>();
    const localFor = (timezone: string) => {
      if (!localByTimezone.has(timezone)) {
        localByTimezone.set(timezone, this.nowInTimezone(now, timezone));
      }
      return localByTimezone.get(timezone);
    };

    const overdueIds: string[] = [];
    for (const log of candidates) {
      const timezone = timezoneByPatientId.get(log.patientId);
      if (!timezone) continue;

      const elapsed = this.minutesSinceScheduled(
        log.doseDate,
        log.scheduledTime,
        localFor(timezone),
      );
      if (elapsed === undefined) continue;

      if (elapsed > this.graceMinutesFor(log.status)) overdueIds.push(log.id);
    }

    if (overdueIds.length === 0) return 0;

    // Re-asserting the status in the WHERE closes the race with a patient logging one
    // of these doses between the read above and this write — their TAKEN wins.
    const result = await this.doseLogRepo
      .createQueryBuilder()
      .update(MedicationDoseLog)
      .set({ status: DoseStatus.MISSED })
      .where('id IN (:...ids)', { ids: overdueIds })
      .andWhere('status IN (:...statuses)', {
        statuses: [DoseStatus.PENDING, DoseStatus.LATER],
      })
      .execute();

    return result.affected ?? 0;
  }

  private nowInTimezone(now: Date, timezone: string): LocalClock | undefined {
    return nowInTimezone(now, timezone);
  }

  /**
   * Minutes elapsed since a dose's scheduled moment, in the patient's own timezone.
   * Negative while the dose is still ahead.
   *
   * Returns undefined when the label is unparseable, does not apply on that date, or
   * the patient's timezone could not be read. Every caller treats that as "skip",
   * never as "missed" — one unreadable label must not silently mark a patient
   * non-adherent, the same way it never breaks their schedule elsewhere.
   */
  private minutesSinceScheduled(
    doseDate: string,
    scheduledTime: string,
    nowLocal: LocalClock | undefined,
  ): number | undefined {
    // The shared helper counts days at UTC midnight, which is what keeps an 11:59 PM
    // dose read at 00:30 the next local day only 31 minutes old rather than a day late.
    const until = minutesUntilScheduled(doseDate, scheduledTime, nowLocal);
    return until === undefined ? undefined : -until;
  }

  /** LATER doses get the longer grace — the patient deferred them deliberately. */
  private graceMinutesFor(status: DoseStatus): number {
    return status === DoseStatus.LATER ? this.laterDoseGraceMinutes() : this.doseGraceMinutes();
  }

  private doseGraceMinutes(): number {
    const configured = this.configService.get<number>('app.medicationDoseGraceMinutes');
    return configured && configured > 0 ? configured : DEFAULT_DOSE_GRACE_MINUTES;
  }

  private laterDoseGraceMinutes(): number {
    const configured = this.configService.get<number>('app.medicationLaterDoseGraceMinutes');
    return configured && configured > 0 ? configured : DEFAULT_LATER_DOSE_GRACE_MINUTES;
  }

  // Overlays DUE_NOW onto a PENDING dose from DUE_NOW_WINDOW_MINUTES before its slot
  // onwards. Only applies to the day being viewed as "today" in the patient's own
  // timezone. Read-time only — the persisted row stays PENDING, since LogDoseDto
  // never accepts DUE_NOW as a status a patient can write.
  //
  // The window is deliberately ASYMMETRIC and open-ended on the past side. It used to
  // be ±15 minutes, which meant a dose 16+ minutes late fell back to plain PENDING and
  // the frontend labelled a dose that was already in the past as "upcoming". Capping
  // the overlay at the grace period instead would reintroduce the same bug in the gap
  // between grace expiring and the next sweep tick. So PENDING now means only "still
  // ahead": once the slot is reached the dose reads DUE_NOW until the sweep persists
  // MISSED, at which point this overlay no longer applies and the real status shows.
  private resolveDisplayStatus(
    status: DoseStatus,
    scheduledTime: string,
    doseDate: string,
    nowLocal: { dateIso: string; minutes: number } | undefined,
  ): DoseStatus {
    if (status !== DoseStatus.PENDING || !nowLocal || nowLocal.dateIso !== doseDate) return status;

    const elapsed = this.minutesSinceScheduled(doseDate, scheduledTime, nowLocal);
    if (elapsed === undefined) return status;

    return elapsed >= -DUE_NOW_WINDOW_MINUTES ? DoseStatus.DUE_NOW : status;
  }

  /**
   * The parser for `scheduleTimes` entries — used by the due-now overlay, the reminder
   * window, dose-log creation and slot ordering. Shared with appointments, which parse
   * the same style of label, so both stay in step: see common/utils/time-label.util.ts.
   */
  private parseDoseTime(label: string): ParsedTimeLabel | undefined {
    return parseTimeLabel(label);
  }

  /** True when a dose time applies on the given date — always, unless it names a day. */
  private appliesOnDate(parsed: ParsedTimeLabel, dateIso: string): boolean {
    return appliesOnDate(parsed, dateIso);
  }

  private async getOwnedMedication(userId: string, id: string): Promise<Medication> {
    const patient = await this.patientsService.getMyProfile(userId);
    const medication = await this.medicationRepo.findOne({ where: { id, patientId: patient.id } });
    if (!medication) throw new NotFoundException(`Medication ${id} not found`);
    return medication;
  }

  /**
   * Dose rows are created lazily — only when someone reads that date's schedule. A row
   * for a slot the patient never looked at is therefore born hours after the fact, and
   * the sweep never saw it because it did not exist. So the correct status is decided
   * here at insert time too: a slot already past its grace is inserted MISSED rather
   * than PENDING, which is what stops a first read at 8 PM showing an 8 AM dose as
   * upcoming until the next tick.
   */
  private async ensureDoseLogsForDate(
    patientId: string,
    medications: Medication[],
    date: string,
    nowLocal: { dateIso: string; minutes: number } | undefined,
  ): Promise<void> {
    const rows = medications.flatMap((med) =>
      med.scheduleTimes
        // A weekly dose belongs to one weekday. Without this filter it was logged
        // every day of the week, so a weekly medication looked due daily.
        .filter((time) => {
          const parsed = this.parseDoseTime(time);
          return parsed ? this.appliesOnDate(parsed, date) : false;
        })
        .map((time) => {
          const elapsed = this.minutesSinceScheduled(date, time, nowLocal);
          const missed = elapsed !== undefined && elapsed > this.doseGraceMinutes();
          return {
            id: ulid(),
            medicationId: med.id,
            patientId,
            doseDate: date,
            scheduledTime: time,
            status: missed ? DoseStatus.MISSED : DoseStatus.PENDING,
          };
        }),
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
        status: In([DoseStatus.PENDING, DoseStatus.LATER, DoseStatus.SKIPPED, DoseStatus.MISSED]),
      },
    });
    return nonTaken === 0;
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
