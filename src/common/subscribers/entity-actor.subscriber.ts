// TODO: Implement — see docs/modules/subscribers.md

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { DataSource, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';

@Injectable()
export class EntityActorSubscriber implements EntitySubscriberInterface<BaseEntity> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cls: ClsService,
  ) {
    this.dataSource.subscribers.push(this);
  }

  listenTo() {
    return BaseEntity;
  }

  beforeInsert(event: InsertEvent<BaseEntity>) {
    const userId = this.cls.get<string>('userId');
    if (userId) {
      event.entity.createdBy = userId;
      event.entity.updatedBy = userId;
    }
  }

  beforeUpdate(event: UpdateEvent<BaseEntity>) {
    const userId = this.cls.get<string>('userId');
    if (userId && event.entity) {
      (event.entity as BaseEntity).updatedBy = userId;
    }
  }
}
