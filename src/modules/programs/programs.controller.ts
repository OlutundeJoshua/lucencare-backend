import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { UserRole } from 'src/common/enums';

import { CreateProgramDto } from './dto/create-program.dto';
import { ReviewEnrollmentDto } from './dto/review-enrollment.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { ListProgramsDto } from './dto/list-programs.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ProgramsService } from './programs.service';

@ApiTags('programs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get('browse')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Browse approved non-expired programs (patient-facing)' })
  async browse(@Query() query: PaginationDto) {
    const { programs, nextCursor } = await this.programsService.browseForPatient(query);
    return { data: programs, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Create a programme as a draft (NGO admin only)' })
  async create(@Body() dto: CreateProgramDto, @CurrentUser() user: JwtPayload) {
    // Returned bare: TransformInterceptor only unwraps a payload carrying BOTH
    // `data` and `meta`, so a hand-wrapped { data } became { data: { data } } on
    // the wire. Paginated handlers below keep their { data, meta } shape.
    return this.programsService.create(user.orgId!, dto);
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Submit a draft or rejected programme for platform review' })
  @ApiResponse({ status: 201, description: 'Programme is now awaiting review' })
  @ApiResponse({ status: 403, description: 'Programme belongs to a different organization' })
  @ApiResponse({ status: 404, description: 'Programme not found' })
  @ApiResponse({ status: 409, description: 'Programme is not in a submittable state' })
  async submit(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.programsService.submitForReview(id, user.orgId!, user.sub);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Get one of your own programmes' })
  @ApiResponse({ status: 403, description: 'Programme belongs to a different organization' })
  @ApiResponse({ status: 404, description: 'Programme not found' })
  async findOneForOrg(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.programsService.getForOrg(id, user.orgId!);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Update your own programme, including pause/resume' })
  @ApiResponse({ status: 200, description: 'Programme updated' })
  @ApiResponse({ status: 403, description: 'Programme belongs to a different organization' })
  @ApiResponse({ status: 404, description: 'Programme not found' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.programsService.update(id, user.orgId!, dto, user.sub);
  }

  @Get(':id/matches')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Get aggregate match preview for a program (no patient IDs)' })
  async getMatchPreview(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.programsService.getMatchPreview(id, user.orgId!);
  }

  @Get(':id/enrollments')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'List enrollments for a program (snapshot data only)' })
  async getEnrollments(
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { enrollments, nextCursor } = await this.programsService.getEnrollments(
      id,
      user.orgId!,
      pagination,
    );
    return {
      data: enrollments,
      meta: { cursor: nextCursor, limit: pagination.limit },
    };
  }

  @Patch(':programId/enrollments/:enrollmentId')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Select, waitlist or reject an applicant' })
  @ApiResponse({ status: 200, description: 'Decision recorded; the applicant is emailed' })
  @ApiResponse({ status: 403, description: 'Programme belongs to a different organization' })
  @ApiResponse({ status: 404, description: 'Programme or enrollment not found' })
  @ApiResponse({ status: 409, description: 'Already in that state, patient-owned, or programme full' })
  @ApiResponse({ status: 422, description: 'Validation failed — a reason is required when rejecting' })
  async reviewEnrollment(
    @Param('programId') programId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: ReviewEnrollmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.programsService.reviewEnrollment(
      programId,
      enrollmentId,
      user.orgId!,
      user.sub,
      dto,
    );
  }

  @Post(':id/notify')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Trigger fan-out notification for an approved program' })
  async triggerFanOut(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.programsService.triggerFanOut(id, user.orgId!);
    return { message: 'Notification job queued' };
  }
}

@ApiTags('programs')
@Controller('organizations')
export class OrgProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get(':orgId/programs')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'List programs for an organization (org-scoped)' })
  async findByOrg(
    @Param('orgId') orgId: string,
    @Query() query: ListProgramsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied: org scope mismatch');
    }
    const { programs, nextCursor } = await this.programsService.findByOrg(orgId, query);
    return {
      data: programs,
      meta: { cursor: nextCursor, limit: query.limit },
    };
  }

  @Get(':orgId/stats')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Dashboard aggregates for an organization (org-scoped)' })
  getStats(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload) {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied: org scope mismatch');
    }
    return this.programsService.getOrgStats(orgId);
  }

  @Get(':orgId/patient-map')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Applicant counts per state — aggregates only, no patient rows' })
  getPatientMap(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload) {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied: org scope mismatch');
    }
    return this.programsService.getPatientMap(orgId);
  }
}
