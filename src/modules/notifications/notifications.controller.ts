// TODO: Implement — see docs/modules/notifications.md

import { Controller, Get, Patch, Param, Query } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  listMine(@Query() pagination: PaginationDto) {
    return this.notificationsService.listForCurrentUser(pagination);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}
