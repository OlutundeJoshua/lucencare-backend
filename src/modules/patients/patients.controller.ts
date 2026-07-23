import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

import { PatientsService } from './patients.service';
import {
  CareEventQueryDto,
  CreateCareEventDto,
  CreatePatientDto,
  ListLinkRequestsQueryDto,
  LookupPatientDto,
  RespondToLinkRequestDto,
  UpdatePatientDto,
} from './dto/patient.dto';

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(JwtAuthGuard, RoleGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  // Static routes first — must be defined before /:id routes

  @Post()
  @Roles(UserRole.HMO_COORDINATOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'HMO coordinator manually registers a patient' })
  @ApiResponse({ status: 201, description: 'Patient created' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  @ApiResponse({ status: 409, description: 'Phone or membership number already registered' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  createPatient(@Body() dto: CreatePatientDto, @CurrentUser() user: JwtPayload) {
    return this.patientsService.createPatient(dto, user.orgId!);
  }

  @Get('me')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Get own patient profile' })
  @ApiResponse({ status: 200, description: 'Patient profile' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  getMyProfile(@CurrentUser() user: JwtPayload) {
    return this.patientsService.getMyProfile(user.sub);
  }

  @Patch('me')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Update own patient profile' })
  @ApiResponse({ status: 200, description: 'Updated patient profile' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  updateMyProfile(@Body() dto: UpdatePatientDto, @CurrentUser() user: JwtPayload) {
    return this.patientsService.updateMyProfile(user.sub, dto);
  }

  @Get('me/link-requests')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'List HMO link requests for the authenticated patient' })
  @ApiResponse({ status: 200, description: 'List of link requests' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  getMyLinkRequests(@Query() query: ListLinkRequestsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.patientsService.getMyLinkRequests(user.sub, query.status);
  }

  @Patch('me/link-requests/:requestId')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Approve or reject a link request' })
  @ApiResponse({ status: 200, description: 'Updated link request' })
  @ApiResponse({ status: 400, description: 'Invalid action' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Link request not found' })
  @ApiResponse({ status: 409, description: 'Already actioned or patient already linked' })
  @ApiResponse({ status: 410, description: 'Link request has expired' })
  respondToLinkRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RespondToLinkRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.patientsService.respondToLinkRequest(requestId, user.sub, dto.action);
  }

  @Get('lookup')
  @Roles(UserRole.HMO_COORDINATOR)
  @ApiOperation({ summary: 'Global patient lookup by phone or membership number (HMO coordinator)' })
  @ApiResponse({ status: 200, description: 'Patient found' })
  @ApiResponse({ status: 400, description: 'Neither phone nor membershipNumber provided' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  @ApiResponse({ status: 404, description: 'Patient not found or no HMO_CARE consent' })
  lookup(@Query() dto: LookupPatientDto, @CurrentUser() user: JwtPayload) {
    return this.patientsService.lookupPatient(dto, user.orgId!);
  }

  // Dynamic routes below

  @Post(':id/link-request')
  @Roles(UserRole.HMO_COORDINATOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Send a link request to a self-registered patient' })
  @ApiResponse({ status: 201, description: 'Link request sent' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Patient has no active HMO_CARE consent' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  @ApiResponse({ status: 409, description: 'Patient already linked or pending request exists' })
  createLinkRequest(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.patientsService.createLinkRequest(id, user.orgId!);
  }

  @Get(':id')
  @Roles(UserRole.HMO_COORDINATOR)
  @ApiOperation({ summary: 'Get a patient by ID (scoped to coordinator org)' })
  @ApiResponse({ status: 200, description: 'Patient record' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  @ApiResponse({ status: 404, description: 'Patient not found or outside org scope' })
  getPatientById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.patientsService.getPatientById(id, user.orgId!);
  }

  @Get(':id/events')
  @Roles(UserRole.HMO_COORDINATOR)
  @ApiOperation({ summary: 'List care events for a patient (cursor-paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated care events' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  @ApiResponse({ status: 404, description: 'Patient not found or outside org scope' })
  @ApiResponse({ status: 422, description: 'Invalid cursor or limit' })
  getCareEvents(
    @Param('id') id: string,
    @Query() query: CareEventQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.patientsService.getCareEvents(id, user.orgId!, query);
  }

  @Post(':id/events')
  @Roles(UserRole.HMO_COORDINATOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a care event for a patient' })
  @ApiResponse({ status: 201, description: 'Care event created' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  @ApiResponse({ status: 404, description: 'Patient not found or outside org scope' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  createCareEvent(
    @Param('id') id: string,
    @Body() dto: CreateCareEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.patientsService.createCareEvent(id, user.orgId!, dto);
  }

  @Get(':id/summary')
  @Roles(UserRole.HMO_COORDINATOR)
  @ApiOperation({
    summary: 'Get full patient summary for PDF export',
    description:
      'Requires a valid single-use export JWT in Authorization: Bearer header. ' +
      'The export token (obtained from POST /export/tokens) replaces the session JWT for this endpoint ' +
      'and must contain the patientId claim matching :id.',
  })
  @ApiResponse({ status: 200, description: 'Full patient summary' })
  @ApiResponse({ status: 401, description: 'Export token missing, invalid, expired, or already used' })
  @ApiResponse({ status: 403, description: 'Patient not within org scope' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getSummary(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const exportToken = (req.headers['authorization'] as string | undefined)?.split(' ')[1];
    if (!exportToken) throw new UnauthorizedException('Export token required');
    return this.patientsService.getPatientSummary(id, user.orgId!, exportToken);
  }
}
