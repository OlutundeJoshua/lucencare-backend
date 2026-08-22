import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/modules/auth/entities/user.entity';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  // User only — the service reads the caller's display name for the system
  // prompt. No AI-specific entity: conversations are not persisted.
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
