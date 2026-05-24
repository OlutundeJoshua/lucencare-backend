// TODO: Implement — see docs/modules/messages.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Message } from './entities/message.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async send(_dto: SendMessageDto) {
    // Validates sender and recipient are enrollment participants
    throw new Error('Not implemented');
  }

  async getThread(_enrollmentId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async markRead(_messageId: string) {
    throw new Error('Not implemented');
  }
}
