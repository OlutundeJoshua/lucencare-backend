import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/modules/audit/audit.module';
import { User } from 'src/modules/auth/entities/user.entity';
import { ADMIN_QUEUE, MAIL_QUEUE } from 'src/queues/queues.constants';

import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ProfessionalApplication } from './entities/professional-application.entity';
import { BenefactorApplication } from './entities/benefactor-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProfessionalApplication, BenefactorApplication, User]),
    AuditModule,
    // Applicant-facing emails and the platform-admin review alert.
    BullModule.registerQueue({ name: MAIL_QUEUE }, { name: ADMIN_QUEUE }),
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
