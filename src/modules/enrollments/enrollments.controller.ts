// TODO: Implement — see docs/modules/enrollments.md

import { Controller, Get, Post, Body, Param } from '@nestjs/common';

import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto, CreateStudyEnrollmentDto } from './dto/enrollment.dto';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  create(@Body() dto: CreateEnrollmentDto) {
    return this.enrollmentsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.enrollmentsService.findOne(id);
  }
}

@Controller('study-enrollments')
export class StudyEnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  create(@Body() dto: CreateStudyEnrollmentDto) {
    return this.enrollmentsService.createStudyEnrollment(dto);
  }
}
