import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from 'src/common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums';

import { CreateStudyDto } from './dto/create-study.dto';
import { ListStudiesDto, ListStudyEnrollmentsDto } from './dto/list-studies.dto';
import { StudiesService } from './studies.service';

@ApiTags('studies')
@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.RESEARCHER)
  @ApiOperation({ summary: 'Submit a new study (researcher only)' })
  async create(@Body() dto: CreateStudyDto, @CurrentUser() user: JwtPayload) {
    const study = await this.studiesService.create(user.sub, dto);
    return { data: study };
  }

  @Get(':id/enrollments')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.RESEARCHER)
  @ApiOperation({ summary: 'List study enrollments (researcher-scoped, no contact info unless shared)' })
  async getEnrollments(
    @Param('id') id: string,
    @Query() query: ListStudyEnrollmentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { enrollments, nextCursor } = await this.studiesService.getEnrollments(
      id,
      user.sub,
      query,
    );
    return {
      data: enrollments,
      meta: { cursor: nextCursor, limit: query.limit },
    };
  }
}

@ApiTags('studies')
@Controller('researchers')
export class ResearcherStudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Get(':researcherId/studies')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.RESEARCHER)
  @ApiOperation({ summary: 'List studies for a researcher (owner-scoped)' })
  async findByResearcher(
    @Param('researcherId') researcherId: string,
    @Query() query: ListStudiesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { studies, nextCursor } = await this.studiesService.findByResearcher(
      researcherId,
      user.sub,
      query,
    );
    return {
      data: studies,
      meta: { cursor: nextCursor, limit: query.limit },
    };
  }
}

@ApiTags('studies')
@Controller('study-enrollments')
export class StudyEnrollmentsController {
  constructor(private readonly studiesService: StudiesService) {}

  // A-3: Spec says no request body — path param :id identifies the enrollment to advance.
  @Post(':id/invite')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.RESEARCHER)
  @ApiOperation({ summary: 'Advance a study enrollment status (researcher only)' })
  async invite(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const enrollment = await this.studiesService.inviteParticipant(id, user.sub);
    return { data: enrollment };
  }
}
