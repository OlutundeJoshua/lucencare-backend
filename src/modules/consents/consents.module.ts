import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { AuditModule } from 'src/modules/audit/audit.module';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';

import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { ConsentGrant } from './entities/consent-grant.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConsentGrant, Patient, Enrollment, StudyEnrollment]),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    AuditModule,
  ],
  controllers: [ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
