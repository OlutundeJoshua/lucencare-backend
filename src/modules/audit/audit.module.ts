import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';
import { BenefactorApplication } from 'src/modules/applications/entities/benefactor-application.entity';
import { ProfessionalApplication } from 'src/modules/applications/entities/professional-application.entity';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Entities are registered with forFeature rather than by importing their owning
 * modules: ApplicationsModule and AuthModule already import AuditModule for
 * AuditService, so importing them back would be a circular dependency. forFeature
 * registers repository providers only and creates no module edge.
 *
 * These repositories exist purely so AuditService.attachResource() can turn a
 * resourceId into a display name for the admin audit screen.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      User,
      Organization,
      Program,
      Study,
      ProfessionalApplication,
      BenefactorApplication,
    ]),
  ],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
