import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { ApplicationsService } from 'src/modules/applications/applications.service';
import { ListApplicationsQueryDto, ReviewApplicationDto } from 'src/modules/applications/dto/applications.dto';
import { AuditService } from 'src/modules/audit/audit.service';
import { ListAuditDto } from 'src/modules/audit/dto/list-audit.dto';
import { ListProgramsDto } from 'src/modules/programs/dto/list-programs.dto';
import { ProgramsService } from 'src/modules/programs/programs.service';

import { AdminService } from './admin.service';
import { AdminApproveDto } from './dto/admin-approve.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly applicationsService: ApplicationsService,
    private readonly auditService: AuditService,
    // The review queue reads programmes across every org, which the NGO-scoped
    // findByOrg cannot serve.
    private readonly programsService: ProgramsService,
  ) {}

  @Get('audit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List audit log entries, newest first (keyset paginated)' })
  @ApiResponse({ status: 200, description: 'Audit log entries' })
  async listAudit(@Query() query: ListAuditDto) {
    const { entries, nextCursor } = await this.auditService.findAll(query);
    return { data: entries, meta: { cursor: nextCursor, limit: query.limit ?? 50 } };
  }

  @Patch('organizations/:id')
  @ApiResponse({ status: 200, description: 'Organization approved or rejected' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Organization not in a reviewable state' })
  @ApiResponse({ status: 422, description: 'Validation failed — reason required on rejection' })
  reviewOrganization(
    @Param('id') id: string,
    @Body() dto: AdminApproveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.reviewOrganization(id, user.sub, dto);
  }

  @Get('programs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List submitted programmes for review, newest first' })
  @ApiResponse({ status: 200, description: 'Programmes awaiting or past review' })
  async listPrograms(@Query() query: ListProgramsDto) {
    // Drafts are excluded in the service: they are the NGO's private working copy.
    const { programs, nextCursor } = await this.programsService.findAllForAdmin(query);
    return { data: programs, meta: { cursor: nextCursor, limit: query.limit ?? 20 } };
  }

  @Patch('programs/:id')
  @ApiResponse({ status: 200, description: 'Program approved or rejected' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Program not found' })
  @ApiResponse({ status: 409, description: 'Program not in a reviewable state' })
  @ApiResponse({ status: 422, description: 'Validation failed — reason required on rejection' })
  reviewProgram(
    @Param('id') id: string,
    @Body() dto: AdminApproveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.reviewProgram(id, user.sub, dto);
  }

  @Patch('studies/:id')
  @ApiResponse({ status: 200, description: 'Study approved or rejected' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Study not found' })
  @ApiResponse({ status: 409, description: 'Study not in a reviewable state' })
  @ApiResponse({ status: 422, description: 'Validation failed — reason required on rejection' })
  reviewStudy(
    @Param('id') id: string,
    @Body() dto: AdminApproveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.reviewStudy(id, user.sub, dto);
  }

  @Get('applications/professional')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List professional applications (filterable by status)' })
  @ApiResponse({ status: 200, description: 'List of professional applications' })
  listProfessionalApplications(@Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findAllProfessional(query.status);
  }

  @Patch('applications/professional/:id/review')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a professional application' })
  @ApiResponse({ status: 200, description: 'Application reviewed; user activated on approval' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 409, description: 'Application not in a reviewable state' })
  reviewProfessionalApplication(
    @Param('id') id: string,
    @Body() dto: ReviewApplicationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.applicationsService.reviewProfessional(id, user.sub, dto);
  }

  @Get('applications/benefactor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List benefactor applications (filterable by status)' })
  @ApiResponse({ status: 200, description: 'List of benefactor applications' })
  listBenefactorApplications(@Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findAllBenefactor(query.status);
  }

  @Patch('applications/benefactor/:id/review')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a benefactor application' })
  @ApiResponse({ status: 200, description: 'Application reviewed; user activated on approval' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 409, description: 'Application not in a reviewable state' })
  reviewBenefactorApplication(
    @Param('id') id: string,
    @Body() dto: ReviewApplicationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.applicationsService.reviewBenefactor(id, user.sub, dto);
  }
}
