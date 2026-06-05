import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { StudyEnrollmentStatus, StudyStatus } from 'src/common/enums';
import { ADMIN_QUEUE, STUDY_REVIEW_JOB } from 'src/queues/queues.constants';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';
import { MatchingService } from 'src/modules/matching/matching.service';

import { CreateStudyDto } from './dto/create-study.dto';
import { ListStudiesDto, ListStudyEnrollmentsDto } from './dto/list-studies.dto';
import { Study } from './entities/study.entity';

// A-5: Contact fields stripped from sharedDataSnapshot when directContactShared=false.
// TODO: Move CONTACT_FIELDS to src/common/constants/snapshot-fields.ts when that file is implemented.
const CONTACT_FIELDS = ['email', 'phone', 'contactEmail', 'contactPhone'];

const VALID_INVITE_TRANSITIONS: Record<StudyEnrollmentStatus, StudyEnrollmentStatus | null> = {
  [StudyEnrollmentStatus.INTERESTED]: StudyEnrollmentStatus.SCREENED,
  [StudyEnrollmentStatus.SCREENED]: StudyEnrollmentStatus.ENROLLED,
  [StudyEnrollmentStatus.ENROLLED]: null,
  [StudyEnrollmentStatus.WITHDRAWN]: null,
};

export interface StudyEnrollmentSnapshot {
  id: string;
  studyId: string;
  status: StudyEnrollmentStatus;
  sharedDataSnapshot: Record<string, unknown>;
  directContactShared: boolean;
  createdAt: string;
}

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,

    // A-1: Injected directly to avoid circular dep with EnrollmentsModule (ARCHITECTURE.md §10.5).
    @InjectRepository(StudyEnrollment)
    private readonly studyEnrollmentRepo: Repository<StudyEnrollment>,

    private readonly matchingService: MatchingService,

    @InjectQueue(ADMIN_QUEUE)
    private readonly adminQueue: Queue,
  ) {}

  async create(researcherId: string, dto: CreateStudyDto): Promise<Study> {
    const existing = await this.studyRepo
      .createQueryBuilder('s')
      .where('s.irb_number = :irbNumber', { irbNumber: dto.irbNumber })
      .andWhere('s.status != :rejected', { rejected: StudyStatus.REJECTED })
      .andWhere('s.deleted_at IS NULL')
      .getOne();

    if (existing) {
      throw new ConflictException(
        `A study with IRB number ${dto.irbNumber} already exists and has not been rejected`,
      );
    }

    const study = this.studyRepo.create({
      researcherId,
      title: dto.title,
      irbNumber: dto.irbNumber,
      eligibilityCriteria: dto.eligibilityCriteria,
      infoSheetUrl: dto.infoSheetUrl,
      targetCount: dto.targetCount,
      compensationDetails: dto.compensationDetails,
      status: StudyStatus.PENDING_REVIEW,
    });
    const saved = await this.studyRepo.save(study);

    await this.adminQueue.add(STUDY_REVIEW_JOB, {
      studyId: saved.id,
      researcherId,
      irbNumber: saved.irbNumber,
      title: saved.title,
    });

    return saved;
  }

  async findByResearcher(
    researcherId: string,
    callerId: string,
    query: ListStudiesDto,
  ): Promise<{ studies: Study[]; nextCursor?: string }> {
    if (callerId !== researcherId) {
      throw new ForbiddenException('Access denied: you can only view your own studies');
    }

    const limit = query.limit ?? 20;

    const qb = this.studyRepo
      .createQueryBuilder('s')
      .where('s.researcher_id = :researcherId', { researcherId })
      .andWhere('s.deleted_at IS NULL')
      .orderBy('s.id', 'ASC')
      .take(limit + 1);

    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (query.cursor) {
      qb.andWhere('s.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { studies: rows, nextCursor };
  }

  async findByIdForResearcher(id: string, researcherId: string): Promise<Study> {
    const study = await this.studyRepo.findOne({ where: { id } });
    if (!study) {
      throw new NotFoundException(`Study ${id} not found`);
    }
    if (study.researcherId !== researcherId) {
      throw new ForbiddenException('Access denied: study belongs to a different researcher');
    }
    return study;
  }

  async getEnrollments(
    studyId: string,
    researcherId: string,
    query: ListStudyEnrollmentsDto,
  ): Promise<{ enrollments: StudyEnrollmentSnapshot[]; nextCursor?: string }> {
    await this.findByIdForResearcher(studyId, researcherId);

    const limit = query.limit ?? 20;

    const qb = this.studyEnrollmentRepo
      .createQueryBuilder('se')
      .where('se.study_id = :studyId', { studyId })
      .orderBy('se.id', 'ASC')
      .take(limit + 1);

    if (query.status) {
      qb.andWhere('se.status = :status', { status: query.status });
    }
    if (query.cursor) {
      qb.andWhere('se.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    const enrollments: StudyEnrollmentSnapshot[] = rows.map((se) => {
      let snapshot = { ...(se.sharedDataSnapshot as Record<string, unknown>) };
      // BR-5: Strip contact fields from snapshot when researcher has not been granted direct contact.
      if (!se.directContactShared) {
        for (const field of CONTACT_FIELDS) {
          delete snapshot[field];
        }
      }
      return {
        id: se.id,
        studyId: se.studyId,
        status: se.status,
        sharedDataSnapshot: snapshot,
        directContactShared: se.directContactShared,
        createdAt: se.createdAt.toISOString(),
      };
    });

    return { enrollments, nextCursor };
  }

  async inviteParticipant(
    studyEnrollmentId: string,
    researcherId: string,
  ): Promise<StudyEnrollment> {
    const enrollment = await this.studyEnrollmentRepo.findOne({
      where: { id: studyEnrollmentId },
    });
    if (!enrollment) {
      throw new NotFoundException(`Study enrollment ${studyEnrollmentId} not found`);
    }

    const study = await this.studyRepo.findOne({ where: { id: enrollment.studyId } });
    if (!study || study.researcherId !== researcherId) {
      throw new ForbiddenException('Access denied: study belongs to a different researcher');
    }

    const nextStatus = VALID_INVITE_TRANSITIONS[enrollment.status];
    if (nextStatus === null || nextStatus === undefined) {
      throw new ConflictException(
        `Invalid status transition: ${enrollment.status} cannot be advanced via invite`,
      );
    }

    enrollment.status = nextStatus;
    return this.studyEnrollmentRepo.save(enrollment);
  }

  async updateStatus(studyId: string, status: StudyStatus): Promise<Study> {
    const study = await this.studyRepo.findOne({ where: { id: studyId } });
    if (!study) {
      throw new NotFoundException(`Study ${studyId} not found`);
    }

    study.status = status;
    const saved = await this.studyRepo.save(study);

    if (status === StudyStatus.APPROVED) {
      await this.matchingService.indexStudy(studyId);
    }

    return saved;
  }
}
