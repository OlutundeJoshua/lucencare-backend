// TODO: Implement — see docs/modules/matching.md

import { Controller, Get, Query } from '@nestjs/common';

import { MatchingService } from './matching.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Controller('recommendations')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('funding')
  getFundingRecommendations(@Query() pagination: PaginationDto) {
    return this.matchingService.findPrograms(pagination);
  }

  @Get('studies')
  getStudyRecommendations(@Query() pagination: PaginationDto) {
    return this.matchingService.findStudies(pagination);
  }
}
