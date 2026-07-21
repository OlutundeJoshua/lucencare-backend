import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Patient } from 'src/modules/patients/entities/patient.entity';
import { PatientsModule } from 'src/modules/patients/patients.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { AuditModule } from 'src/modules/audit/audit.module';
import { User } from 'src/modules/auth/entities/user.entity';

import { MedicationsController } from './medications.controller';
import { MedicationsService } from './medications.service';
import { Medication } from './entities/medication.entity';
import { MedicationDoseLog } from './entities/medication-dose-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Medication, MedicationDoseLog, Patient, User]),
    PatientsModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [MedicationsController],
  providers: [MedicationsService],
  exports: [MedicationsService],
})
export class MedicationsModule {}
