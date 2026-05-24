// TODO: Implement — see docs/modules/patients.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { UpdatePatientDto, LookupPatientDto, CreateCareEventDto } from './dto/patient.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(CareEvent)
    private readonly careEventRepo: Repository<CareEvent>,
  ) {}

  async getMyProfile() {
    throw new Error('Not implemented');
  }

  async updateMyProfile(_dto: UpdatePatientDto) {
    throw new Error('Not implemented');
  }

  async lookup(_dto: LookupPatientDto) {
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async listEvents(_patientId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async createEvent(_patientId: string, _dto: CreateCareEventDto) {
    throw new Error('Not implemented');
  }

  async getSummary(_patientId: string) {
    // Validates export JWT before returning snapshot
    throw new Error('Not implemented');
  }
}
