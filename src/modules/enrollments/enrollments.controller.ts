import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationDto } from 'src/common/dto/pagination.dto';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from 'src/common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums';

import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto, CreateStudyEnrollmentDto } from './dto/enrollment.dto';

@ApiTags('enrollments')
@Controller('enrollments')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PATIENT)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List own program enrollments (cursor-paginated)' })
  listMine(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    return this.enrollmentsService.listMyEnrollments(user.sub, query);
  }

  @Post()
  create(@Body() dto: CreateEnrollmentDto, @CurrentUser() user: JwtPayload) {
    return this.enrollmentsService.createEnrollment(user.sub, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.enrollmentsService.getEnrollment(id, user.sub);
  }
}

@ApiTags('study-enrollments')
@Controller('study-enrollments')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PATIENT)
export class StudyEnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List own study enrollments (cursor-paginated)' })
  listMine(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    return this.enrollmentsService.listMyStudyEnrollments(user.sub, query);
  }

  @Post()
  create(@Body() dto: CreateStudyEnrollmentDto, @CurrentUser() user: JwtPayload) {
    return this.enrollmentsService.createStudyEnrollment(user.sub, dto);
  }
}
