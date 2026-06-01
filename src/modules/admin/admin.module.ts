import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { OrganizationsModule } from 'src/modules/organizations/organizations.module';
import { ProgramsModule } from 'src/modules/programs/programs.module';
import { StudiesModule } from 'src/modules/studies/studies.module';
import { MatchingModule } from 'src/modules/matching/matching.module';
import { AuditModule } from 'src/modules/audit/audit.module';
import { ADMIN_QUEUE } from 'src/queues/queues.constants';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    OrganizationsModule,
    ProgramsModule,
    StudiesModule,
    MatchingModule,
    AuditModule,
    BullModule.registerQueue({ name: ADMIN_QUEUE }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
