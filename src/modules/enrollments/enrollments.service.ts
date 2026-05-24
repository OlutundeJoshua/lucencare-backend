// TODO: Implement — see docs/modules/enrollments.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrollment } from './entities/enrollment.entity';
import { StudyEnrollment } from './entities/study-enrollment.entity';
import { CreateEnrollmentDto, CreateStudyEnrollmentDto } from './dto/enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    @InjectRepository(StudyEnrollment)
    private readonly studyEnrollmentRepo: Repository<StudyEnrollment>,
  ) {}

  async create(_dto: CreateEnrollmentDto) {
    // Checks active consent, builds sharedDataSnapshot from SNAPSHOT_FIELDS
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async createStudyEnrollment(_dto: CreateStudyEnrollmentDto) {
    throw new Error('Not implemented');
  }

  async revokeByConsentGrant(_consentGrantId: string) {
    // Called by ConsentsService on revocation — tombstones all linked enrollments
    throw new Error('Not implemented');
  }

  async getEnrollmentParticipants(_enrollmentId: string) {
    throw new Error('Not implemented');
  }
}
