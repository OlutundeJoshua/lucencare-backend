import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

/**
 * Every call here costs real money upstream, so this bounds spend as much as load.
 * Follows the per-route @Throttle pattern from community.controller.ts.
 *
 * ThrottlerGuard is listed explicitly in @UseGuards below, which community's
 * routes do not do: ThrottlerModule.forRootAsync is configured in app.module.ts,
 * but nothing registers the guard as an APP_GUARD, so @Throttle metadata alone is
 * inert. Until that is fixed centrally, a route needing a limit must name the
 * guard. Note this tracks per-IP (ThrottlerGuard's default), not per-user.
 */
const CHAT_THROTTLE = { default: { limit: 15, ttl: 60_000 } };

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
// Patients only. Lucy is a patient-facing assistant, and the conversation carries
// the patient's own health disclosures — no organisation role has business here.
@UseGuards(JwtAuthGuard, RoleGuard, ThrottlerGuard)
@Roles(UserRole.PATIENT)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @HttpCode(200)
  @Throttle(CHAT_THROTTLE)
  @ApiOperation({ summary: 'Send a conversation to the AI health assistant and get its reply' })
  @ApiResponse({ status: 200, description: 'The assistant reply' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Too many messages in a short window' })
  @ApiResponse({ status: 503, description: 'The assistant is unconfigured or upstream is unavailable' })
  chat(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload) {
    return this.aiService.chat(user.sub, dto.messages);
  }
}
