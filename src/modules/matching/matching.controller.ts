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

  @Get('funding')
  getFundingRecommendations(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    return this.matchingService.findMatchingPrograms(user.sub, query);
  }

  @Get('studies')
  getStudyRecommendations(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    return this.matchingService.findStudies(user.sub, query);
  }
}
