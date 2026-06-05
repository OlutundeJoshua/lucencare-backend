import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { OrgStatus, ProgramStatus, ProgramType } from 'src/common/enums';
import {
  ADMIN_QUEUE,
  FAN_OUT_NOTIFY_JOB,
  NOTIFICATIONS_QUEUE,
  PROGRAM_REVIEW_JOB,
} from 'src/queues/queues.constants';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { MatchingService } from 'src/modules/matching/matching.service';

import { CreateProgramDto } from './dto/create-program.dto';
import { ListProgramsDto } from './dto/list-programs.dto';
import { Program } from './entities/program.entity';

export interface EnrollmentSnapshot {
  id: string;
  status: string;
  sharedDataSnapshot: Record<string, unknown>;
  createdAt: string;
}

@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,

    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,

    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    private readonly matchingService: MatchingService,

    @InjectQueue(ADMIN_QUEUE)
    private readonly adminQueue: Queue,

    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  async create(orgId: string, dto: CreateProgramDto): Promise<Program> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }
    if (org.status !== OrgStatus.ACTIVE) {
      throw new ForbiddenException('Organization must be active to create programs');
    }
    if (dto.type !== ProgramType.NGO_FUNDING) {
      throw new UnprocessableEntityException('NGO admins may only create NGO_FUNDING programs');
    }
    if (new Date(dto.expiresAt) <= new Date()) {
      throw new UnprocessableEntityException('expiresAt must be in the future');
    }

    const program = this.programRepo.create({
      orgId,
      title: dto.title,
      type: dto.type,
      eligibilityCriteria: dto.eligibilityCriteria,
      expiresAt: new Date(dto.expiresAt),
      status: ProgramStatus.PENDING_REVIEW,
    });
    const saved = await this.programRepo.save(program);

    await this.adminQueue.add(PROGRAM_REVIEW_JOB, {
      programId: saved.id,
      orgId,
      title: saved.title,
    });

    return saved;
  }

  async findByOrg(
    orgId: string,
    query: ListProgramsDto,
  ): Promise<{ programs: Program[]; nextCursor?: string }> {
    const limit = query.limit ?? 20;

    const qb = this.programRepo
      .createQueryBuilder('p')
      .where('p.org_id = :orgId', { orgId })
      .andWhere('p.deleted_at IS NULL')
      .orderBy('p.id', 'ASC')
      .take(limit + 1);

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }
    if (query.cursor) {
      qb.andWhere('p.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { programs: rows, nextCursor };
  }

  async findByIdForOrg(id: string, orgId: string): Promise<Program> {
    const program = await this.programRepo.findOne({ where: { id } });
    if (!program) {
      throw new NotFoundException(`Program ${id} not found`);
    }
    if (program.orgId !== orgId) {
      throw new ForbiddenException('Access denied: program belongs to a different organization');
    }
    return program;
  }

  async getMatchPreview(
    programId: string,
    orgId: string,
  ): Promise<{ eligibleCount: number; tagSummary: Record<string, number> }> {
    await this.findByIdForOrg(programId, orgId);
    return this.matchingService.getProgramMatchPreview(programId);
  }

  async getEnrollments(
    programId: string,
    orgId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ enrollments: EnrollmentSnapshot[]; nextCursor?: string }> {
    await this.findByIdForOrg(programId, orgId);

    const limit = query.limit ?? 20;

    const qb = this.enrollmentRepo
      .createQueryBuilder('e')
      .where('e.program_id = :programId', { programId })
      .andWhere('e.deleted_at IS NULL')
      .orderBy('e.id', 'ASC')
      .take(limit + 1);

    if (query.cursor) {
      qb.andWhere('e.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    const enrollments: EnrollmentSnapshot[] = rows.map((e) => ({
      id: e.id,
      status: e.status,
      sharedDataSnapshot: e.sharedDataSnapshot as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    }));

    return { enrollments, nextCursor };
  }

  async triggerFanOut(programId: string, orgId: string): Promise<void> {
    const program = await this.findByIdForOrg(programId, orgId);

    if (program.status !== ProgramStatus.APPROVED) {
      throw new ConflictException('Program must be approved before triggering fan-out notifications');
    }
    if (program.expiresAt <= new Date()) {
      throw new ConflictException('Program has expired and cannot trigger notifications');
    }

    await this.notificationsQueue.add(FAN_OUT_NOTIFY_JOB, { programId, orgId });
  }

  async updateStatus(programId: string, status: ProgramStatus): Promise<Program> {
    const program = await this.programRepo.findOne({ where: { id: programId } });
    if (!program) {
      throw new NotFoundException(`Program ${programId} not found`);
    }

    program.status = status;
    const saved = await this.programRepo.save(program);

    if (status === ProgramStatus.APPROVED) {
      await this.matchingService.indexProgram(programId);
    }

    return saved;
  }
}
