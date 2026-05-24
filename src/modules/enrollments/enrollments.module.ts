// TODO: Implement — see docs/modules/enrollments.md

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment } from './entities/enrollment.entity';
import { StudyEnrollment } from './entities/study-enrollment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Enrollment, StudyEnrollment])],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
