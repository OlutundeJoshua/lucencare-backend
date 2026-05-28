import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EntityActorSubscriber } from './subscribers/entity-actor.subscriber';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [EntityActorSubscriber, TransformInterceptor, GlobalExceptionFilter],
  exports: [EntityActorSubscriber, TransformInterceptor, GlobalExceptionFilter],
})
export class CommonModule {}
