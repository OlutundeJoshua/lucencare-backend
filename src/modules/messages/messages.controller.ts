// TODO: Implement — see docs/modules/messages.md

import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';

import { MessagesService } from './messages.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  send(@Body() dto: SendMessageDto) {
    return this.messagesService.send(dto);
  }

  @Get(':enrollmentId')
  getThread(@Param('enrollmentId') enrollmentId: string, @Query() pagination: PaginationDto) {
    return this.messagesService.getThread(enrollmentId, pagination);
  }
}
