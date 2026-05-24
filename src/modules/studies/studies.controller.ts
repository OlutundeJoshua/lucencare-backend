// TODO: Implement — see docs/modules/studies.md

import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';

import { StudiesService } from './studies.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateStudyDto } from './dto/create-study.dto';
import { InviteParticipantDto } from './dto/invite-participant.dto';

@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post()
  create(@Body() dto: CreateStudyDto) {
    return this.studiesService.create(dto);
  }

  @Get(':id/enrollments')
  listEnrollments(@Param('id') id: string, @Query() pagination: PaginationDto) {
    return this.studiesService.listEnrollments(id, pagination);
  }
}

@Controller('study-enrollments')
export class StudyEnrollmentsController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post(':id/invite')
  invite(@Param('id') id: string, @Body() dto: InviteParticipantDto) {
    return this.studiesService.inviteParticipant(id, dto);
  }
}
