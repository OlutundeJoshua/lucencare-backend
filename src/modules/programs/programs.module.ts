import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MatchingModule } from 'src/modules/matching/matching.module';
import { AuditModule } from 'src/modules/audit/audit.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { QueuesModule } from 'src/queues/queues.module';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { OrgProgramsController, ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { Program } from './entities/program.entity';

@Module({
  imports: [
    // Patient/User are here only so reviewEnrollment can resolve the applicant's
    // email for the outcome notice — they are never joined into an org-facing read.
    TypeOrmModule.forFeature([Program, Organization, Enrollment, Patient, User]),
    MatchingModule,
    AuditModule,
    NotificationsModule,
    QueuesModule,
  ],
  controllers: [ProgramsController, OrgProgramsController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
