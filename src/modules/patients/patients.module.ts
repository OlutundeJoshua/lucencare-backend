// TODO: Implement — see docs/modules/patients.md

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { HmoLinkRequest } from './entities/hmo-link-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, CareEvent, HmoLinkRequest])],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
