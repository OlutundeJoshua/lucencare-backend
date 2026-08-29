import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PublicService } from './public.service';

/**
 * The unauthenticated surface. Everything here is readable by a stranger, so a
 * route only belongs in this module if that is a deliberate decision rather
 * than an oversight — which is the point of keeping them together instead of
 * scattering guard-less routes through the feature modules.
 *
 * ThrottlerGuard is named explicitly: ThrottlerModule is configured in
 * app.module.ts but nothing registers the guard as an APP_GUARD, so @Throttle
 * metadata alone is inert. Same reasoning as ai.controller.ts.
 */
const STATS_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('public')
@Controller('public')
@UseGuards(ThrottlerGuard)
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('stats')
  @Throttle(STATS_THROTTLE)
  @ApiOperation({ summary: 'Aggregate platform totals for the public landing page' })
  @ApiResponse({ status: 200, description: 'Registered patients and approved NGO programmes' })
  @ApiResponse({ status: 429, description: 'Too many requests in a short window' })
  getStats() {
    return this.publicService.getStats();
  }
}
