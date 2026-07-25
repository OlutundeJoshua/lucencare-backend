import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { AppointmentStatus, AppointmentType } from 'src/common/enums';

@Entity('appointments')
@Index(['patientId'])
@Index(['patientId', 'appointmentDate'])
export class Appointment extends BaseEntity {
  @Column({ name: 'patient_id', type: 'char', length: 26 })
  patientId: string;

  @Column({ name: 'appointment_date', type: 'date' })
  appointmentDate: string;

  @Column({ name: 'time', type: 'text' })
  time: string;

  @Column({ name: 'duration', type: 'text' })
  duration: string;

  @Column({ name: 'provider', type: 'text' })
  provider: string;

  @Column({ name: 'specialty', type: 'text' })
  specialty: string;

  @Column({ name: 'facility', type: 'text' })
  facility: string;

  @Column({ name: 'type', type: 'enum', enum: AppointmentType })
  type: AppointmentType;

  @Column({ name: 'status', type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.CONFIRMED })
  status: AppointmentStatus;

  @Column({ name: 'note', type: 'text', nullable: true })
  note?: string;
}
