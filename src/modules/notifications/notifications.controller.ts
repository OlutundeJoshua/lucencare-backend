import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
// Every notification belongs to exactly one user, so the feed is always scoped to the
// JWT subject — no role may read another user's notifications, and until now these
// two routes carried no guard at all.
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Static routes first — must be defined before /:id routes

  @Get('me')
  @ApiOperation({ summary: "List the authenticated user's notifications, newest first" })
  @ApiResponse({ status: 200, description: 'Notifications plus the unread count' })
  listMine(@Query() query: ListNotificationsDto, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.listForCurrentUser(user.sub, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every unread notification as read' })
  @ApiResponse({ status: 200, description: 'Number of notifications updated' })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllRead(user.sub);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({ status: 200, description: 'The updated notification' })
  @ApiResponse({ status: 403, description: 'Notification belongs to another user' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.markRead(id, user.sub);
  }
}
