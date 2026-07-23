import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { UserRole } from 'src/common/enums';

import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // GET /organizations — admin org list
  // A-7: added in V1; spec §9 flagged this as an open question, user confirmed implementation.
  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List organizations (platform admin only)' })
  async findAll(@Query() dto: ListOrganizationsDto) {
    const { orgs, nextCursor } = await this.organizationsService.findAll(dto);
    return {
      data: orgs,
      meta: { cursor: nextCursor, limit: dto.limit ?? 20 },
    };
  }

  // GET /organizations/:id — org detail
  // Org-scope enforced by service (callerOrgId = user.orgId).
  // BR-3 (suspended → 403) also enforced in service.findOne when callerOrgId is provided.
  @Get(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN, UserRole.HMO_COORDINATOR)
  @ApiOperation({ summary: 'Get organization detail (org staff only, org-scoped)' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.organizationsService.findOne(id, user.orgId);
  }
}
