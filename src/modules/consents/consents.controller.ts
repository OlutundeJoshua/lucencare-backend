import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from 'src/common/decorators/current-user.decorator';

import { ConsentsService } from './consents.service';
import { CreateConsentGrantDto } from './dto/create-consent-grant.dto';
import { UpdateConsentDto } from './dto/update-consent.dto';

@ApiTags('consents')
@ApiBearerAuth()
@Controller('consents')
@UseGuards(JwtAuthGuard, RoleGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  // Static routes defined before dynamic /:id routes

  @Get('me')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'List all consent grants for the authenticated patient' })
  @ApiResponse({ status: 200, description: 'List of consent grants (all statuses)' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires patient role' })
  getMyConsents(@CurrentUser() user: JwtPayload) {
    return this.consentsService.getMyConsents(user.sub);
  }

  @Post()
  @Roles(UserRole.PATIENT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new consent grant for an additional purpose' })
  @ApiResponse({ status: 201, description: 'Consent grant created' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires patient role' })
  @ApiResponse({ status: 409, description: 'Non-revoked consent grant already exists for this purpose' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  create(@Body() dto: CreateConsentGrantDto, @CurrentUser() user: JwtPayload) {
    return this.consentsService.create(user.sub, dto);
  }

  @Patch(':id')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Transition a consent grant to a new status' })
  @ApiResponse({ status: 200, description: 'Consent grant updated' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires patient role or grant belongs to another patient' })
  @ApiResponse({ status: 404, description: 'Consent grant not found' })
  @ApiResponse({ status: 409, description: 'Invalid state machine transition or concurrent modification' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  transition(@Param('id') id: string, @Body() dto: UpdateConsentDto, @CurrentUser() user: JwtPayload) {
    return this.consentsService.transition(id, user.sub, dto);
  }

  @Get(':id/impact')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Preview the impact of revoking a consent grant (read-only)' })
  @ApiResponse({ status: 200, description: 'Impact summary' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires patient role or grant belongs to another patient' })
  @ApiResponse({ status: 404, description: 'Consent grant not found' })
  getImpact(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.consentsService.getImpact(id, user.sub);
  }
}
