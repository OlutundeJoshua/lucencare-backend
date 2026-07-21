import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { MAIL_QUEUE } from 'src/queues/queues.constants';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { PatientsModule } from 'src/modules/patients/patients.module';
import { User } from 'src/modules/auth/entities/user.entity';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { Appointment } from './entities/appointment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, Patient, User]),
    PatientsModule,
    BullModule.registerQueue({ name: MAIL_QUEUE }),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
