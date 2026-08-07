import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  AuditAction,
  EnrollmentStatus,
  LIVE_ENROLLMENT_STATUSES,
  NotificationType,
  OrgStatus,
  ProgramStatus,
  ProgramType,
} from 'src/common/enums';
import {
  ADMIN_QUEUE,
  FAN_OUT_NOTIFY_JOB,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  NOTIFICATIONS_QUEUE,
  PROGRAM_REVIEW_JOB,
  SEND_ENROLLMENT_OUTCOME_JOB,
} from 'src/queues/queues.constants';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { MatchingService } from 'src/modules/matching/matching.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';

import { CreateProgramDto } from './dto/create-program.dto';
import { ListProgramsDto } from './dto/list-programs.dto';
import { ReviewEnrollmentDto } from './dto/review-enrollment.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { Program } from './entities/program.entity';
import { EnrollmentSnapshot } from './interfaces/enrollment-snapshot.interface';
import { OrgStats } from './interfaces/org-stats.interface';
import { PatientMapRow } from './interfaces/patient-map-row.interface';
import { ProgramLifecycle } from './interfaces/program-lifecycle.type';
import { ProgramView } from './interfaces/program-view.interface';

/** A programme within this many days of expiry reads as "Closing" to its NGO. */
const CLOSING_SOON_DAYS = 14;

@Injectable()
export class ProgramsService {
  private readonly logger = new Logger(ProgramsService.name);

  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,

    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,

    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    // Resolving the applicant's email for the outcome notice. Reached only from
    // reviewEnrollment — never joined into anything an org can read.
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly dataSource: DataSource,

    private readonly auditService: AuditService,

    private readonly matchingService: MatchingService,

    private readonly notificationsService: NotificationsService,

    @InjectQueue(ADMIN_QUEUE)
    private readonly adminQueue: Queue,

    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,

    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue,
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
      description: dto.description,
      focus: dto.focus,
      donor: dto.donor,
      coordinator: dto.coordinator,
      budgetTotal: dto.budgetTotal,
      slotsTotal: dto.slotsTotal,
      // Counters start at zero and are the platform's to move, never the NGO's.
      budgetDisbursed: 0,
      slotsFilled: 0,
    });
    const saved = await this.programRepo.save(program);

    await this.adminQueue.add(PROGRAM_REVIEW_JOB, {
      programId: saved.id,
      orgId,
      title: saved.title,
    });

    return this.toView(saved);
  }

  /**
   * NGO-scoped edit. Ownership is enforced by findByIdForOrg, so a programme
   * belonging to another organisation 403s before anything is written.
   */
  async update(id: string, orgId: string, dto: UpdateProgramDto): Promise<ProgramView> {
    const program = await this.findByIdForOrg(id, orgId);

    if (dto.expiresAt !== undefined && new Date(dto.expiresAt) <= new Date()) {
      throw new UnprocessableEntityException('expiresAt must be in the future');
    }
    // Capacity cannot be cut below what has already been committed, or the
    // programme would report more filled places than it has.
    if (dto.slotsTotal !== undefined && dto.slotsTotal < program.slotsFilled) {
      throw new UnprocessableEntityException(
        `slotsTotal cannot be below the ${program.slotsFilled} place(s) already filled`,
      );
    }
    if (dto.budgetTotal !== undefined && dto.budgetTotal < program.budgetDisbursed) {
      throw new UnprocessableEntityException(
        'budgetTotal cannot be below the amount already disbursed',
      );
    }

    // TypeORM's update() treats `undefined` as "leave this column alone", so
    // resuming must write an explicit null — assigning undefined would silently
    // never clear pausedAt, leaving Resume as a no-op.
    const patch: Partial<Program> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.focus !== undefined) patch.focus = dto.focus;
    if (dto.donor !== undefined) patch.donor = dto.donor;
    if (dto.coordinator !== undefined) patch.coordinator = dto.coordinator;
    if (dto.budgetTotal !== undefined) patch.budgetTotal = dto.budgetTotal;
    if (dto.slotsTotal !== undefined) patch.slotsTotal = dto.slotsTotal;
    if (dto.expiresAt !== undefined) patch.expiresAt = new Date(dto.expiresAt);
    // The client states intent; the server owns the clock.
    if (dto.paused !== undefined) patch.pausedAt = dto.paused ? new Date() : null;

    if (Object.keys(patch).length > 0) {
      await this.programRepo.update({ id }, patch);
    }

    const updated = await this.programRepo.findOne({ where: { id } });
    return this.toView(updated as Program);
  }

  async findByOrg(
    orgId: string,
    query: ListProgramsDto,
  ): Promise<{ programs: ProgramView[]; nextCursor?: string }> {
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

    // One `now` for the whole page so two programmes on the same list cannot be
    // classified against different clocks.
    const now = new Date();
    return { programs: rows.map((p) => this.toView(p, now)), nextCursor };
  }

  /**
   * Dashboard headline numbers for one organisation.
   *
   * Two aggregate queries rather than a per-programme fetch and a JS reduce: the
   * counts must stay correct when an NGO has more programmes than one page holds.
   */
  async getOrgStats(orgId: string): Promise<OrgStats> {
    const now = new Date();

    const programRow = await this.programRepo
      .createQueryBuilder('p')
      .select('COUNT(*)', 'totalPrograms')
      .addSelect(
        `COUNT(*) FILTER (
           WHERE p.status = :approved
             AND p.paused_at IS NULL
             AND p.expires_at > :now
             AND (p.slots_total IS NULL OR p.slots_filled < p.slots_total)
         )`,
        'activePrograms',
      )
      .addSelect('COALESCE(SUM(p.budget_total), 0)', 'budgetTotal')
      .addSelect('COALESCE(SUM(p.budget_disbursed), 0)', 'budgetDisbursed')
      .addSelect('COALESCE(SUM(p.slots_total), 0)', 'slotsTotal')
      .addSelect('COALESCE(SUM(p.slots_filled), 0)', 'slotsFilled')
      .where('p.org_id = :orgId', { orgId })
      .andWhere('p.deleted_at IS NULL')
      .setParameters({ approved: ProgramStatus.APPROVED, now })
      .getRawOne<Record<string, string>>();

    // Enrollments are reached through the org's own programmes — the patients table
    // is never touched, so no consent boundary is crossed to produce a count.
    const enrollmentRow = await this.enrollmentRepo
      .createQueryBuilder('e')
      .innerJoin(Program, 'p', 'p.id = e.program_id')
      .select('COUNT(*)', 'totalApplicants')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :active)`, 'pendingReview')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :selected)`, 'selectedPatients')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :waitlisted)`, 'waitlisted')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :rejected)`, 'rejected')
      .where('p.org_id = :orgId', { orgId })
      .andWhere('e.deleted_at IS NULL')
      .setParameters({
        active: EnrollmentStatus.ACTIVE,
        selected: EnrollmentStatus.SELECTED,
        waitlisted: EnrollmentStatus.WAITLISTED,
        rejected: EnrollmentStatus.REJECTED,
      })
      .getRawOne<Record<string, string>>();

    const n = (row: Record<string, string> | undefined, key: string): number =>
      Number(row?.[key] ?? 0);

    return {
      activePrograms: n(programRow, 'activePrograms'),
      totalPrograms: n(programRow, 'totalPrograms'),
      totalApplicants: n(enrollmentRow, 'totalApplicants'),
      pendingReview: n(enrollmentRow, 'pendingReview'),
      selectedPatients: n(enrollmentRow, 'selectedPatients'),
      waitlisted: n(enrollmentRow, 'waitlisted'),
      rejected: n(enrollmentRow, 'rejected'),
      budgetTotal: n(programRow, 'budgetTotal'),
      budgetDisbursed: n(programRow, 'budgetDisbursed'),
      slotsTotal: n(programRow, 'slotsTotal'),
      slotsFilled: n(programRow, 'slotsFilled'),
    };
  }

  /**
   * Where this organisation's applicants are, by state.
   *
   * The patients table is joined for `location_state` alone, and only ever inside a
   * GROUP BY — no patient row, id or field leaves this method. That keeps the
   * §8 rule intact: an org still receives snapshots, never patient records.
   */
  async getPatientMap(orgId: string): Promise<PatientMapRow[]> {
    const rows = await this.enrollmentRepo
      .createQueryBuilder('e')
      .innerJoin(Program, 'p', 'p.id = e.program_id')
      .leftJoin(Patient, 'pat', 'pat.id = e.patient_id')
      .select(`COALESCE(NULLIF(pat.location_state, ''), 'Unspecified')`, 'state')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :selected)`, 'selected')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :active)`, 'inReview')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = :waitlisted)`, 'waitlisted')
      .addSelect('COUNT(*)', 'total')
      .where('p.org_id = :orgId', { orgId })
      .andWhere('e.deleted_at IS NULL')
      .andWhere('e.status IN (:...live)', { live: [...LIVE_ENROLLMENT_STATUSES] })
      .setParameters({
        selected: EnrollmentStatus.SELECTED,
        active: EnrollmentStatus.ACTIVE,
        waitlisted: EnrollmentStatus.WAITLISTED,
      })
      .groupBy('1')
      .orderBy('4', 'DESC')
      .getRawMany<Record<string, string>>();

    const topConditions = await this.topConditionByState(orgId);

    return rows.map((r) => ({
      state: r['state'],
      selected: Number(r['selected'] ?? 0),
      inReview: Number(r['inReview'] ?? 0),
      waitlisted: Number(r['waitlisted'] ?? 0),
      total: Number(r['total'] ?? 0),
      topCondition: topConditions.get(r['state']),
    }));
  }

  /**
   * The most common condition tag per state, unnested from the snapshot in SQL.
   *
   * DISTINCT ON keeps one row per state — the tag with the highest count — without a
   * window function or a second round trip per state.
   */
  private async topConditionByState(orgId: string): Promise<Map<string, string>> {
    const byState = new Map<string, string>();

    // TypeORM's builder cannot express jsonb_array_elements_text in a LATERAL join,
    // so this one aggregate is a parameterised raw query.
    const raw: Array<{ state: string; tag: string }> = await this.enrollmentRepo.query(
      `
      SELECT DISTINCT ON (state) state, tag
      FROM (
        SELECT COALESCE(NULLIF(pat.location_state, ''), 'Unspecified') AS state,
               tag.value AS tag,
               COUNT(*) AS tag_count
        FROM enrollments e
        JOIN programs p ON p.id = e.program_id
        LEFT JOIN patients pat ON pat.id = e.patient_id
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(e.shared_data_snapshot -> 'conditionTags', '[]'::jsonb)
        ) AS tag(value)
        WHERE p.org_id = $1
          AND e.deleted_at IS NULL
          AND e.status = ANY($2::text[])
        GROUP BY state, tag.value
      ) counted
      ORDER BY state, tag_count DESC, tag ASC
      `,
      [orgId, [...LIVE_ENROLLMENT_STATUSES]],
    );

    for (const row of raw) byState.set(row.state, row.tag);
    return byState;
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

  /** Same ownership rules as findByIdForOrg, with the derived fields the UI needs. */
  async getForOrg(id: string, orgId: string): Promise<ProgramView> {
    return this.toView(await this.findByIdForOrg(id, orgId));
  }

  /**
   * Derives the operational state from stored data. Order matters: a paused
   * programme reads Paused even if also full, because pausing is a deliberate act
   * and full is a consequence.
   */
  private lifecycleOf(program: Program, now = new Date()): ProgramLifecycle {
    if (program.status !== ProgramStatus.APPROVED) {
      return program.status === ProgramStatus.EXPIRED ? 'Expired' : 'Draft';
    }
    if (program.expiresAt <= now) return 'Expired';
    if (program.pausedAt) return 'Paused';

    const total = program.slotsTotal;
    if (total !== undefined && total !== null && program.slotsFilled >= total) return 'Full';

    const daysLeft = (program.expiresAt.getTime() - now.getTime()) / 86_400_000;
    return daysLeft <= CLOSING_SOON_DAYS ? 'Closing' : 'Active';
  }

  /** Attaches the derived fields the NGO UI renders. */
  private toView(program: Program, now = new Date()): ProgramView {
    const total = program.slotsTotal ?? 0;
    return Object.assign(program, {
      lifecycle: this.lifecycleOf(program, now),
      // Clamped: an over-filled programme should read 0 remaining, never negative.
      slotsAvailable: Math.max(0, total - (program.slotsFilled ?? 0)),
    });
  }

  async browseForPatient(
    query: PaginationDto,
  ): Promise<{ programs: Pick<Program, 'id' | 'title' | 'type' | 'orgId' | 'expiresAt'>[]; nextCursor?: string }> {
    const qb = this.programRepo
      .createQueryBuilder('p')
      // Entity property paths, not DB column names. With 'p.org_id'/'p.expires_at'
      // TypeORM silently DROPPED both from the result rather than erroring, so this
      // endpoint returned {id,title,type} while its signature promised five fields.
      .select(['p.id', 'p.title', 'p.type', 'p.orgId', 'p.expiresAt'])
      .where('p.status = :status', { status: ProgramStatus.APPROVED })
      .andWhere('p.expires_at > NOW()')
      .andWhere('p.deleted_at IS NULL')
      .orderBy('p.id', 'ASC')
      .take(query.limit + 1);

    if (query.cursor) {
      qb.andWhere('p.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { programs: rows, nextCursor };
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

    // Deliberately NOT joining patients (CLAUDE.md §8): an org sees only the
    // point-in-time snapshot captured at enrollment, never the live record. Note
    // patientId and consentGrantId are dropped here, not merely unselected.
    const enrollments: EnrollmentSnapshot[] = rows.map((e) => ({
      id: e.id,
      status: e.status,
      sharedDataSnapshot: e.sharedDataSnapshot as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
      rejectionReason: e.rejectionReason ?? undefined,
      reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : undefined,
    }));

    return { enrollments, nextCursor };
  }

  /**
   * Record an NGO's decision on one applicant.
   *
   * Slot accounting is the substantive part: SELECTED occupies a place, everything
   * else releases it. Both the decision and the counter move in one transaction, so
   * a programme can never report more filled places than it has selected patients.
   */
  async reviewEnrollment(
    programId: string,
    enrollmentId: string,
    orgId: string,
    reviewerId: string,
    dto: ReviewEnrollmentDto,
  ): Promise<EnrollmentSnapshot> {
    const program = await this.findByIdForOrg(programId, orgId);

    const enrollment = await this.enrollmentRepo.findOne({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.programId !== programId) {
      throw new NotFoundException(`Enrollment ${enrollmentId} not found for this program`);
    }

    // The patient owns these two outcomes; an NGO must not overwrite them.
    if (
      enrollment.status === EnrollmentStatus.REVOKED_BY_PATIENT ||
      enrollment.status === EnrollmentStatus.EXPIRED
    ) {
      throw new ConflictException(`Cannot review an enrollment that is ${enrollment.status}`);
    }
    if (enrollment.status === dto.status) {
      throw new ConflictException(`Enrollment is already ${dto.status}`);
    }

    const wasSelected = enrollment.status === EnrollmentStatus.SELECTED;
    const willBeSelected = dto.status === EnrollmentStatus.SELECTED;
    const slotDelta = (willBeSelected ? 1 : 0) - (wasSelected ? 1 : 0);

    if (
      slotDelta > 0 &&
      program.slotsTotal !== undefined &&
      program.slotsTotal !== null &&
      program.slotsFilled >= program.slotsTotal
    ) {
      throw new ConflictException('Programme is full — no places remain to select into');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Enrollment).update(
        { id: enrollmentId },
        {
          status: dto.status,
          // Cleared on any non-rejection so a later reversal cannot leave a stale
          // reason attached to an accepted applicant.
          rejectionReason: dto.status === EnrollmentStatus.REJECTED ? dto.reason : null,
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
        },
      );

      if (slotDelta !== 0) {
        // Relative update, not a computed absolute: two reviewers acting at once
        // must not overwrite each other's increment. GREATEST(0, …) so the counter
        // can never go negative even if the data is already inconsistent.
        const op = slotDelta > 0 ? '+' : '-';
        await manager
          .getRepository(Program)
          .createQueryBuilder()
          .update()
          .set({ slotsFilled: () => `GREATEST(0, "slots_filled" ${op} ${Math.abs(slotDelta)})` })
          .where('id = :programId', { programId })
          .execute();
      }
    });

    await this.auditService.log({
      actorId: reviewerId,
      action:
        dto.status === EnrollmentStatus.REJECTED ? AuditAction.ADMIN_REJECT : AuditAction.ADMIN_APPROVE,
      resourceId: enrollmentId,
      resourceType: 'enrollment',
      metadata: { programId, status: dto.status, ...(dto.reason ? { reason: dto.reason } : {}) },
    });

    await this.notifyApplicant(enrollment.patientId, program, dto);

    const updated = (await this.enrollmentRepo.findOne({ where: { id: enrollmentId } })) as Enrollment;
    return {
      id: updated.id,
      status: updated.status,
      sharedDataSnapshot: updated.sharedDataSnapshot as Record<string, unknown>,
      createdAt: updated.createdAt.toISOString(),
      rejectionReason: updated.rejectionReason ?? undefined,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : undefined,
    };
  }

  /**
   * Tell the patient the outcome. Guarded: the decision has already committed, so a
   * queue outage must not report failure for work that succeeded — the reviewer
   * would retry into a 409 "already selected".
   */
  private async notifyApplicant(
    patientId: string,
    program: Program,
    dto: ReviewEnrollmentDto,
  ): Promise<void> {
    try {
      const patient = await this.patientRepo.findOne({
        where: { id: patientId },
        select: ['id', 'userId', 'name'],
      });
      if (!patient) return;

      const user = await this.userRepo.findOne({
        where: { id: patient.userId },
        select: ['id', 'email', 'name'],
      });
      if (!user) return;

      await this.mailQueue.add(
        SEND_ENROLLMENT_OUTCOME_JOB,
        {
          to: user.email,
          patientName: patient.name || user.name || user.email,
          programTitle: program.title,
          status: dto.status,
          reason: dto.reason,
        },
        MAIL_JOB_OPTIONS,
      );

      // The same outcome in the app, for a patient who never opens the email.
      await this.notificationsService.createOne(user.id, NotificationType.ENROLLMENT_UPDATE, {
        programId: program.id,
        programTitle: program.title,
        status: dto.status,
        reason: dto.reason,
      });
    } catch (err) {
      this.logger.error(`Failed to notify applicant of review outcome: ${(err as Error).message}`);
    }
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

  async findOne(id: string): Promise<Program> {
    const program = await this.programRepo.findOne({ where: { id } });
    if (!program) throw new NotFoundException(`Program ${id} not found`);
    return program;
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
