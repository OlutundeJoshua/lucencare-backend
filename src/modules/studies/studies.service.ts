// TODO: Implement — see docs/modules/studies.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Study } from './entities/study.entity';
import { CreateStudyDto } from './dto/create-study.dto';
import { InviteParticipantDto } from './dto/invite-participant.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
  ) {}

  async create(_dto: CreateStudyDto) {
    // Triggers study_review queue job
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async listByResearcher(_researcherId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async listEnrollments(_studyId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async inviteParticipant(_studyEnrollmentId: string, _dto: InviteParticipantDto) {
    throw new Error('Not implemented');
  }

  async updateStatus(_studyId: string, _status: string) {
    throw new Error('Not implemented');
  }
}
