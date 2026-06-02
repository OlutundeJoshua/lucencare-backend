import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { MAIL_QUEUE } from 'src/queues/queues.constants';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { ExportModule } from 'src/modules/export/export.module';
import { AuditModule } from 'src/modules/audit/audit.module';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { HmoLinkRequest } from './entities/hmo-link-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Patient,
      CareEvent,
      HmoLinkRequest,
      ConsentGrant,
      Organization,
    ]),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    NotificationsModule,
    ExportModule,
    AuditModule,
  ],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
