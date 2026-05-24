// TODO: Implement — see docs/modules/notifications.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Notification } from './entities/notification.entity';
import { NotificationType } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async listForCurrentUser(_pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async markRead(_id: string) {
    throw new Error('Not implemented');
  }

  async createBulk(_userIds: string[], _type: NotificationType, _payload: object) {
    // Single bulk INSERT — called by batch_notify processor
    throw new Error('Not implemented');
  }

  async createOne(_userId: string, _type: NotificationType, _payload: object) {
    throw new Error('Not implemented');
  }
}
