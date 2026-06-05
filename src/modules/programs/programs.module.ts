import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MatchingModule } from 'src/modules/matching/matching.module';
import { QueuesModule } from 'src/queues/queues.module';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';

import { OrgProgramsController, ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { Program } from './entities/program.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Program, Organization, Enrollment]),
    MatchingModule,
    QueuesModule,
  ],
  controllers: [ProgramsController, OrgProgramsController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
