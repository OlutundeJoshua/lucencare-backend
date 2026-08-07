import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { UserRole } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

import { MatchingService } from './matching.service';

@ApiTags('recommendations')
@Controller('recommendations')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PATIENT)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  // Both handlers reshape { data, nextCursor } into the { data, meta } envelope the
  // TransformInterceptor unwraps. Returning the service result directly produced a
  // double-wrapped { data: { data: [...] } } body — the same defect already fixed on
  // three programs routes.

  @Get('funding')
  async getFundingRecommendations(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    const { data, nextCursor } = await this.matchingService.findMatchingPrograms(user.sub, query);
    return { data, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Get('studies')
  async getStudyRecommendations(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    const { data, nextCursor } = await this.matchingService.findStudies(user.sub, query);
    return { data, meta: { cursor: nextCursor, limit: query.limit } };
  }
}
