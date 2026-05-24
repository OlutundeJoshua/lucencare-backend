// TODO: Implement — see docs/modules/consents.md

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { ConsentGrant } from './entities/consent-grant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConsentGrant])],
  controllers: [ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
