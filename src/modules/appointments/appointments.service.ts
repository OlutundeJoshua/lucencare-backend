import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';

import {
  AppointmentConfirmationAction,
  AppointmentReminderLead,
  AppointmentStatus,
} from 'src/common/enums';
import { APPOINTMENT_REMINDER_LEAD_MINUTES } from 'src/common/constants/appointment-reminder-leads';
import {
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  SEND_APPOINTMENT_CONFIRMATION_JOB,
} from 'src/queues/queues.constants';
import { SendAppointmentConfirmationJob } from 'src/queues/interfaces/send-appointment-confirmation-job.interface';
import { firstName } from 'src/common/utils/first-name.util';
import { minutesUntilScheduled, nowInTimezone } from 'src/common/utils/time-label.util';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentStatsResult } from './interfaces/appointment-stats-result.interface';
import { AppointmentReminderTarget } from './interfaces/appointment-reminder-target.interface';

const DEFAULT_APPOINTMENT_REMINDER_WINDOW_MINUTES = 5;

/**
 * How far ahead the reminder scan looks for candidate rows. Comfortably past the
 * longest lead so the three-day reminder is always in range, and bounded so the query
 * never widens into the patient's entire appointment history.
 */
// Two days: the furthest lead is one day (APPOINTMENT_REMINDER_LEAD_MINUTES), plus a
// day of margin so no timezone can push an appointment out of range. Every row
// selected past that is discarded by the per-patient window check below.
const REMINDER_SCAN_HORIZON_DAYS = 2;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    // Reminder targeting reads timezone and name straight off the patient rows for a
    // whole batch of appointments; PatientsService resolves one caller's own profile.
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    private readonly patientsService: PatientsService,

    private readonly configService: ConfigService,

    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue,
  ) {}

  async listAppointments(userId: string): Promise<Appointment[]> {
    const patient = await this.patientsService.getMyProfile(userId);
    return this.appointmentRepo.find({
      where: { patientId: patient.id },
      order: { appointmentDate: 'ASC' },
    });
  }

  async createAppointment(userId: string, dto: CreateAppointmentDto): Promise<Appointment> {
    const patient = await this.patientsService.getMyProfile(userId);

    const appointment = this.appointmentRepo.create({
      patientId: patient.id,
      appointmentDate: dto.appointmentDate,
      time: dto.time,
      duration: dto.duration,
      provider: dto.provider,
      specialty: dto.specialty,
      facility: dto.facility,
      type: dto.type,
      status: AppointmentStatus.CONFIRMED,
      note: dto.note,
    });
    const saved = await this.appointmentRepo.save(appointment);

    await this.sendConfirmationEmail(patient, saved, AppointmentConfirmationAction.CREATED);

    return saved;
  }

  async updateAppointment(
    userId: string,
    id: string,
    dto: UpdateAppointmentDto,
  ): Promise<Appointment> {
    const appointment = await this.getOwnedAppointment(userId, id);

    const updates: Partial<Appointment> = {};
    if (dto.provider !== undefined) updates.provider = dto.provider;
    if (dto.specialty !== undefined) updates.specialty = dto.specialty;
    if (dto.facility !== undefined) updates.facility = dto.facility;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.note !== undefined) updates.note = dto.note;

    await this.appointmentRepo.update({ id: appointment.id }, updates);

    return this.getOwnedAppointment(userId, id);
  }

  async rescheduleAppointment(
    userId: string,
    id: string,
    dto: RescheduleAppointmentDto,
  ): Promise<Appointment> {
    const patient = await this.patientsService.getMyProfile(userId);
    const appointment = await this.getOwnedAppointmentForPatient(patient.id, id);

    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.COMPLETED
    ) {
      throw new ConflictException(`Cannot reschedule a ${appointment.status} appointment`);
    }

    await this.appointmentRepo.update(
      { id: appointment.id },
      {
        appointmentDate: dto.appointmentDate,
        time: dto.time,
        duration: dto.duration,
        note: dto.note !== undefined ? dto.note : appointment.note,
        status: AppointmentStatus.CONFIRMED,
      },
    );

    const updated = await this.getOwnedAppointmentForPatient(patient.id, id);
    await this.sendConfirmationEmail(patient, updated, AppointmentConfirmationAction.RESCHEDULED);

    return updated;
  }

  async cancelAppointment(userId: string, id: string): Promise<Appointment> {
    const patient = await this.patientsService.getMyProfile(userId);
    const appointment = await this.getOwnedAppointmentForPatient(patient.id, id);

    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.COMPLETED
    ) {
      throw new ConflictException(`Appointment is already ${appointment.status}`);
    }

    await this.appointmentRepo.update(
      { id: appointment.id },
      { status: AppointmentStatus.CANCELLED },
    );

    return this.getOwnedAppointmentForPatient(patient.id, id);
  }

  async getStats(userId: string): Promise<AppointmentStatsResult> {
    const patient = await this.patientsService.getMyProfile(userId);
    const today = this.todayIso();
    const now = new Date();

    const upcoming = await this.appointmentRepo
      .createQueryBuilder('a')
      .where('a.patient_id = :patientId', { patientId: patient.id })
      .andWhere('a.appointment_date >= :today', { today })
      .getCount();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const thisMonth = await this.appointmentRepo
      .createQueryBuilder('a')
      .where('a.patient_id = :patientId', { patientId: patient.id })
      .andWhere('a.appointment_date >= :today', { today })
      .andWhere('a.appointment_date BETWEEN :monthStart AND :monthEnd', { monthStart, monthEnd })
      .getCount();

    const completed = await this.appointmentRepo.count({
      where: { patientId: patient.id, status: AppointmentStatus.COMPLETED },
    });

    const cancelled = await this.appointmentRepo.count({
      where: { patientId: patient.id, status: AppointmentStatus.CANCELLED },
    });

    return { upcoming, thisMonth, completed, cancelled };
  }

  private async getOwnedAppointment(userId: string, id: string): Promise<Appointment> {
    const patient = await this.patientsService.getMyProfile(userId);
    return this.getOwnedAppointmentForPatient(patient.id, id);
  }

  private async getOwnedAppointmentForPatient(patientId: string, id: string): Promise<Appointment> {
    const appointment = await this.appointmentRepo.findOne({ where: { id, patientId } });
    if (!appointment) throw new NotFoundException(`Appointment ${id} not found`);
    return appointment;
  }

  /**
   * Called by appointment-reminder-tick.processor.ts. Returns every reminder email due
   * on this tick — one target per (appointment, lead) pair that just came into range.
   *
   * Anchored to each patient's own local time, because `appointments.time` is a display
   * label ('10:30 AM') rather than an instant: the same label means a different moment
   * in every timezone, so a window computed from UTC would fire at the wrong hour for
   * anyone outside it.
   *
   * Each lead uses a half-open window `[lead, lead + window)` measured in minutes until
   * the appointment, so an appointment is claimed by exactly one tick per lead — none
   * falls between two ticks, none is reminded twice. This is why the window must equal
   * the tick interval; see the COUPLED PAIR note in app.config.ts.
   */
  async findDueReminderTargets(now: Date = new Date()): Promise<AppointmentReminderTarget[]> {
    const horizon = new Date(now.getTime() + REMINDER_SCAN_HORIZON_DAYS * 86_400_000);

    // Only appointments that are actually going to happen: a cancelled or completed
    // one must never generate a reminder, and status is re-read here rather than
    // trusted from booking time so a cancellation always takes effect.
    const appointments = await this.appointmentRepo
      .createQueryBuilder('a')
      .where('a.status IN (:...statuses)', {
        statuses: [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING],
      })
      // The floor reaches back a day because the date column is compared in UTC while
      // the send decision is made in the patient's zone: someone in UTC-11 can still be
      // on "yesterday" locally, and their appointment must not be clipped out here.
      // Over-selecting is free — the per-patient window check below rejects the rest.
      .andWhere('a.appointment_date BETWEEN :from AND :to', {
        from: isoDate(new Date(now.getTime() - 86_400_000)),
        to: isoDate(horizon),
      })
      .andWhere('a.deleted_at IS NULL')
      .getMany();

    if (appointments.length === 0) return [];

    const patientIds = [...new Set(appointments.map((a) => a.patientId))];
    const patients = await this.patientRepo.find({ where: { id: In(patientIds) } });
    const patientById = new Map(patients.map((p) => [p.id, p]));

    const users = await this.userRepo.find({ where: { id: In(patients.map((p) => p.userId)) } });
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

    const windowMinutes = this.reminderWindowMinutes();
    const leads = Object.entries(APPOINTMENT_REMINDER_LEAD_MINUTES) as Array<
      [AppointmentReminderLead, number]
    >;

    const targets: AppointmentReminderTarget[] = [];
    for (const appointment of appointments) {
      const patient = patientById.get(appointment.patientId);
      if (!patient) continue;

      const email = emailByUserId.get(patient.userId);
      if (!email) continue;

      const local = nowInTimezone(now, patient.timezone ?? 'UTC');
      const until = minutesUntilScheduled(appointment.appointmentDate, appointment.time, local);
      // An unreadable time label is skipped, never guessed at — the same rule the rest
      // of the platform follows for free-form time strings.
      if (until === undefined) continue;

      for (const [lead, leadMinutes] of leads) {
        if (until >= leadMinutes && until < leadMinutes + windowMinutes) {
          targets.push({
            email,
            firstName: firstName(patient.name ?? ''),
            lead,
            appointmentType: appointment.type,
            appointmentDate: appointment.appointmentDate,
            time: appointment.time,
            facility: appointment.facility,
            provider: appointment.provider,
          });
        }
      }
    }

    return targets;
  }

  /** See the COUPLED PAIR note in app.config.ts — must equal the tick interval. */
  private reminderWindowMinutes(): number {
    const configured = this.configService.get<number>('app.appointmentReminderWindowMinutes');
    return configured && configured > 0 ? configured : DEFAULT_APPOINTMENT_REMINDER_WINDOW_MINUTES;
  }

  private async sendConfirmationEmail(
    patient: Patient,
    appointment: Appointment,
    action: AppointmentConfirmationAction,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: patient.userId } });
    if (!user) return;

    const payload: SendAppointmentConfirmationJob = {
      to: user.email,
      patientName: patient.name,
      appointmentDate: appointment.appointmentDate,
      time: appointment.time,
      provider: appointment.provider,
      specialty: appointment.specialty,
      facility: appointment.facility,
      action,
    };
    await this.mailQueue.add(SEND_APPOINTMENT_CONFIRMATION_JOB, payload, MAIL_JOB_OPTIONS);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Plain `YYYY-MM-DD` for a moment, in UTC. Only used to bound the reminder scan's date
 * range, which is deliberately wider than any lead — the exact per-patient timing is
 * decided afterwards in that patient's own timezone.
 */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
