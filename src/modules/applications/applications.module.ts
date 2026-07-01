import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/modules/audit/audit.module';
import { User } from 'src/modules/auth/entities/user.entity';

import { ApplicationsService } from './applications.service';
import { ProfessionalApplication } from './entities/professional-application.entity';
import { BenefactorApplication } from './entities/benefactor-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProfessionalApplication, BenefactorApplication, User]),
    AuditModule,
  ],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
