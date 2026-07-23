// TODO: Implement — see docs/modules/notifications.md

import { ulid } from 'ulid';

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

  // Single bulk INSERT — called by batch_notify processor. Never more than 200 records at once.
  async createBulk(userIds: string[], type: NotificationType, payload: object): Promise<void> {
    if (userIds.length === 0) return;

    const notifications = userIds.map((userId) => this.notificationRepo.create({ id: ulid(), userId, type, payload }));
    await this.notificationRepo
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values(notifications)
      .execute();
  }

  async createOne(userId: string, type: NotificationType, payload: object): Promise<Notification> {
    const notification = this.notificationRepo.create({ userId, type, payload });
    return this.notificationRepo.save(notification);
  }
}
