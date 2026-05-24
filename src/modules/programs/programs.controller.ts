// TODO: Implement — see docs/modules/programs.md

import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';

import { ProgramsService } from './programs.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateProgramDto } from './dto/create-program.dto';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Post()
  create(@Body() dto: CreateProgramDto) {
    return this.programsService.create(dto);
  }

  @Get(':id/matches')
  getMatchPreview(@Param('id') id: string) {
    return this.programsService.getMatchPreview(id);
  }

  @Get(':id/enrollments')
  listEnrollments(@Param('id') id: string, @Query() pagination: PaginationDto) {
    return this.programsService.listEnrollments(id, pagination);
  }

  @Post(':id/notify')
  triggerFanOut(@Param('id') id: string) {
    return this.programsService.triggerFanOut(id);
  }
}
