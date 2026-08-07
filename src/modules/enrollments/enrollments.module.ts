import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { AuditModule } from 'src/modules/audit/audit.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';

import { EnrollmentsController, StudyEnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment } from './entities/enrollment.entity';
import { StudyEnrollment } from './entities/study-enrollment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      StudyEnrollment,
      Program,
      Study,
      Patient,
      ConsentGrant,
      // Resolving the owning NGO's staff to notify them an application arrived.
      User,
    ]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [EnrollmentsController, StudyEnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
