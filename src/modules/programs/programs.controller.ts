import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { UserRole } from 'src/common/enums';

import { CreateProgramDto } from './dto/create-program.dto';
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
  @ApiOperation({ summary: 'Create a program (NGO admin only)' })
  async create(@Body() dto: CreateProgramDto, @CurrentUser() user: JwtPayload) {
    const program = await this.programsService.create(user.orgId!, dto);
    return { data: program };
  }

  @Get(':id/matches')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Get aggregate match preview for a program (no patient IDs)' })
  async getMatchPreview(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const preview = await this.programsService.getMatchPreview(id, user.orgId!);
    return { data: preview };
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

  @Post(':id/notify')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiOperation({ summary: 'Trigger fan-out notification for an approved program' })
  async triggerFanOut(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.programsService.triggerFanOut(id, user.orgId!);
    return { data: { message: 'Notification job queued' } };
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
}
