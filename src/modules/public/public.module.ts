import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';

import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, Program])],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
