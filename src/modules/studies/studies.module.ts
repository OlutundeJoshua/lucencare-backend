import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MatchingModule } from 'src/modules/matching/matching.module';
import { QueuesModule } from 'src/queues/queues.module';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';

import {
  ResearcherStudiesController,
  StudiesController,
  StudyEnrollmentsController,
} from './studies.controller';
import { StudiesService } from './studies.service';
import { Study } from './entities/study.entity';

@Module({
  imports: [
    // A-1: StudyEnrollment registered here directly; EnrollmentsModule not imported to avoid
    // circular dep (ARCHITECTURE.md §10.5). Only StudiesModule writes enrollment status via invite.
    TypeOrmModule.forFeature([Study, StudyEnrollment]),
    MatchingModule,
    QueuesModule,
  ],
  controllers: [StudiesController, ResearcherStudiesController, StudyEnrollmentsController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
