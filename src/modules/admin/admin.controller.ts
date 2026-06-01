import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from 'src/common/decorators/current-user.decorator';

import { AdminService } from './admin.service';
import { AdminApproveDto } from './dto/admin-approve.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
}
