// TODO: Implement — see docs/modules/studies.md

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StudiesController } from './studies.controller';
import { StudiesService } from './studies.service';
import { Study } from './entities/study.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Study])],
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
