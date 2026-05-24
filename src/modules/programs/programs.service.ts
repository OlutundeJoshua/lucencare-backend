// TODO: Implement — see docs/modules/programs.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Program } from './entities/program.entity';
import { CreateProgramDto } from './dto/create-program.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
  ) {}

  async create(_dto: CreateProgramDto) {
    // orgId from JWT, triggers program_review queue job
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async listByOrg(_orgId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async getMatchPreview(_programId: string) {
    // Returns aggregate counts only — no patient IDs
    throw new Error('Not implemented');
  }

  async listEnrollments(_programId: string, _pagination: PaginationDto) {
    // Returns sharedDataSnapshot only — never joins patients table
    throw new Error('Not implemented');
  }

  async triggerFanOut(_programId: string) {
    // Enqueues one fan_out_notify job — not one per patient
    throw new Error('Not implemented');
  }

  async updateStatus(_programId: string, _status: string) {
    throw new Error('Not implemented');
  }
}
