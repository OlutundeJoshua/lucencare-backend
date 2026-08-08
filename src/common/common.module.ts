import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/modules/auth/entities/user.entity';

import { EntityActorSubscriber } from './subscribers/entity-actor.subscriber';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

// Global so that JwtAuthGuard — referenced by @UseGuards() in every feature module —
// can resolve UserRepository for its account-status check without each of those
// modules having to re-declare TypeOrmModule.forFeature([User]).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [EntityActorSubscriber, TransformInterceptor, GlobalExceptionFilter],
  exports: [
    TypeOrmModule,
    EntityActorSubscriber,
    TransformInterceptor,
    GlobalExceptionFilter,
  ],
})
export class CommonModule {}
