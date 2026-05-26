// TODO: Implement — see docs/modules/patients.md

import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';

import { PatientsService } from './patients.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  UpdatePatientDto,
  LookupPatientDto,
  CreateCareEventDto,
  RespondToLinkRequestDto,
  ListLinkRequestsQueryDto,
} from './dto/patient.dto';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get('me')
  getMyProfile() {
    return this.patientsService.getMyProfile();
  }

  @Patch('me')
  updateMyProfile(@Body() dto: UpdatePatientDto) {
    return this.patientsService.updateMyProfile(dto);
  }

  @Get('me/link-requests')
  getMyLinkRequests(@Query() query: ListLinkRequestsQueryDto) {
    return this.patientsService.getMyLinkRequests(query.status);
  }

  @Patch('me/link-requests/:requestId')
  respondToLinkRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RespondToLinkRequestDto,
  ) {
    return this.patientsService.respondToLinkRequest(requestId, dto.action);
  }

  @Get('lookup')
  lookup(@Query() dto: LookupPatientDto) {
    return this.patientsService.lookup(dto);
  }

  @Post(':id/link-request')
  createLinkRequest(@Param('id') id: string) {
    return this.patientsService.createLinkRequest(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Get(':id/events')
  listEvents(@Param('id') id: string, @Query() pagination: PaginationDto) {
    return this.patientsService.listEvents(id, pagination);
  }

  @Post(':id/events')
  createEvent(@Param('id') id: string, @Body() dto: CreateCareEventDto) {
    return this.patientsService.createEvent(id, dto);
  }

  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    return this.patientsService.getSummary(id);
  }
}
