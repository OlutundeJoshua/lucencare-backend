import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';

import { AppointmentConfirmationAction, AppointmentStatus } from 'src/common/enums';
import { MAIL_QUEUE, SEND_APPOINTMENT_CONFIRMATION_JOB } from 'src/queues/queues.constants';
import { SendAppointmentConfirmationJob } from 'src/queues/interfaces/send-appointment-confirmation-job.interface';
import { PatientsService } from 'src/modules/patients/patients.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentStatsResult } from './interfaces/appointment-stats-result.interface';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepo: Repository<Appointment>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly patientsService: PatientsService,

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

  async updateAppointment(userId: string, id: string, dto: UpdateAppointmentDto): Promise<Appointment> {
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

    await this.appointmentRepo.update({ id: appointment.id }, { status: AppointmentStatus.CANCELLED });

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
    await this.mailQueue.add(SEND_APPOINTMENT_CONFIRMATION_JOB, payload);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
