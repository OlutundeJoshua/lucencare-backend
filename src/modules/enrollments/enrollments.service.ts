import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  AuditAction,
  ConsentPurpose,
  ConsentStatus,
  EnrollmentStatus,
  LIVE_ENROLLMENT_STATUSES,
  NotificationType,
  ProgramStatus,
  StudyEnrollmentStatus,
  StudyStatus,
  UserRole,
} from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';

import { Enrollment } from './entities/enrollment.entity';
import { StudyEnrollment } from './entities/study-enrollment.entity';
import { CreateEnrollmentDto, CreateStudyEnrollmentDto } from './dto/enrollment.dto';

// Valid study enrollment state machine transitions
const VALID_STUDY_TRANSITIONS: Partial<Record<StudyEnrollmentStatus, StudyEnrollmentStatus>> = {
  [StudyEnrollmentStatus.INTERESTED]: StudyEnrollmentStatus.SCREENED,
  [StudyEnrollmentStatus.SCREENED]: StudyEnrollmentStatus.ENROLLED,
};

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    @InjectRepository(StudyEnrollment)
    private readonly studyEnrollmentRepo: Repository<StudyEnrollment>,

    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    // Resolving the owning NGO's staff so they learn an application arrived.
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,

    private readonly dataSource: DataSource,
  ) {}

  async createEnrollment(userId: string, dto: CreateEnrollmentDto): Promise<Enrollment> {
    const patientId = await this.resolvePatientId(userId);
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient profile not found');

    const saved = await this.dataSource.transaction(async (manager) => {
      // set_config(..., true) is transaction-local — identical in effect to
      // SET LOCAL, but SET LOCAL is not parameterisable: `SET LOCAL x = $1` is a
      // Postgres syntax error, so the previous form threw on every call and took
      // the whole request down with a 500.
      await manager.query(`SELECT set_config('app.user_id', $1, true)`, [patientId]);

      const program = await manager
        .getRepository(Program)
        .findOne({ where: { id: dto.programId } });
      if (!program) throw new NotFoundException(`Program ${dto.programId} not found`);
      if (program.status !== ProgramStatus.APPROVED) {
        throw new UnprocessableEntityException('Program is not approved');
      }
      if (program.expiresAt <= new Date()) {
        throw new UnprocessableEntityException('Program has expired');
      }

      const grant = await manager
        .getRepository(ConsentGrant)
        .createQueryBuilder('cg')
        .where('cg.patient_id = :patientId', { patientId })
        .andWhere('cg.purpose = :purpose', { purpose: ConsentPurpose.NGO_FUNDING })
        .andWhere('cg.status = :active', { active: ConsentStatus.ACTIVE })
        .andWhere('cg.deleted_at IS NULL')
        .getOne();
      if (!grant) {
        throw new UnprocessableEntityException('No active NGO_FUNDING consent grant');
      }

      // Blocks any LIVE application (applied / selected / waitlisted), not just
      // `active` — otherwise a selected patient could apply to the same programme a
      // second time. Rejected, withdrawn and expired rows deliberately do not block,
      // so someone turned down once may apply again if the programme reopens.
      const existing = await manager
        .getRepository(Enrollment)
        .createQueryBuilder('e')
        .where('e.patient_id = :patientId', { patientId })
        .andWhere('e.program_id = :programId', { programId: dto.programId })
        .andWhere('e.status IN (:...live)', { live: [...LIVE_ENROLLMENT_STATUSES] })
        .andWhere('e.deleted_at IS NULL')
        .getOne();
      if (existing) {
        throw new ConflictException('Patient is already actively enrolled in this program');
      }

      const sharedDataSnapshot = this.buildSnapshot(patient, SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING]);
      const enrollment = manager.getRepository(Enrollment).create({
        patientId,
        programId: dto.programId,
        consentGrantId: grant.id,
        status: EnrollmentStatus.ACTIVE,
        sharedDataSnapshot,
      });
      return manager.getRepository(Enrollment).save(enrollment);
    });

    // The application has committed. Everything below is notification, so a queue
    // outage must not report failure for an enrollment that succeeded.
    await this.announceApplication(saved, patientId);

    return saved;
  }

  /**
   * Tell the NGO an application arrived. Previously createEnrollment wrote one row
   * and emitted nothing at all — no audit, no notification — so an applicant queue
   * only got looked at if someone happened to open the tab.
   */
  private async announceApplication(enrollment: Enrollment, patientId: string): Promise<void> {
    try {
      await this.auditService.log({
        actorId: patientId,
        action: AuditAction.APPLICATION_SUBMITTED,
        resourceId: enrollment.id,
        resourceType: 'enrollment',
        metadata: { programId: enrollment.programId },
      });
    } catch (err) {
      this.logger.error(`Failed to audit enrollment ${enrollment.id}: ${(err as Error).message}`);
    }

    try {
      const program = await this.programRepo.findOne({
        where: { id: enrollment.programId },
        select: ['id', 'orgId', 'title'],
      });
      if (!program) return;

      const staff = await this.userRepo.find({
        where: { orgId: program.orgId, role: UserRole.NGO_ADMIN },
        select: ['id'],
      });
      if (staff.length === 0) return;

      await this.notificationsService.createBulk(
        staff.map((s) => s.id),
        NotificationType.ENROLLMENT_APPLICATION,
        {
          enrollmentId: enrollment.id,
          programId: program.id,
          programTitle: program.title,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify NGO of enrollment ${enrollment.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Withdraw from ONE programme.
   *
   * Until now the only exit was revoking the whole NGO consent grant, which cascaded
   * across every programme under it — a patient could not leave one without leaving
   * all of them.
   */
  async withdrawEnrollment(id: string, userId: string): Promise<Enrollment> {
    const patientId = await this.resolvePatientId(userId);

    const enrollment = await this.enrollmentRepo.findOne({ where: { id } });
    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${id} not found`);
    }
    if (enrollment.patientId !== patientId) {
      throw new ForbiddenException('Access denied: this enrollment does not belong to you');
    }
    if (!LIVE_ENROLLMENT_STATUSES.includes(enrollment.status as never)) {
      throw new ConflictException(`Cannot withdraw an enrollment that is ${enrollment.status}`);
    }

    const wasSelected = enrollment.status === EnrollmentStatus.SELECTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.user_id', $1, true)`, [patientId]);

      await manager
        .getRepository(Enrollment)
        .update({ id }, { status: EnrollmentStatus.REVOKED_BY_PATIENT });

      // Withdrawing after selection frees the place for someone else.
      if (wasSelected) {
        await manager
          .getRepository(Program)
          .createQueryBuilder()
          .update()
          .set({ slotsFilled: () => `GREATEST(0, "slots_filled" - 1)` })
          .where('id = :programId', { programId: enrollment.programId })
          .execute();
      }
    });

    return this.enrollmentRepo.findOne({ where: { id } }) as Promise<Enrollment>;
  }

  async getEnrollment(id: string, userId: string): Promise<Enrollment> {
    const patientId = await this.resolvePatientId(userId);
    const enrollment = await this.enrollmentRepo.findOne({ where: { id } });
    if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
    if (enrollment.patientId !== patientId) {
      throw new ForbiddenException('Access denied: this enrollment does not belong to you');
    }
    return enrollment;
  }

  async createStudyEnrollment(userId: string, dto: CreateStudyEnrollmentDto): Promise<StudyEnrollment> {
    const patientId = await this.resolvePatientId(userId);
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient profile not found');

    return this.dataSource.transaction(async (manager) => {
      // set_config(..., true) is transaction-local — identical in effect to
      // SET LOCAL, but SET LOCAL is not parameterisable: `SET LOCAL x = $1` is a
      // Postgres syntax error, so the previous form threw on every call and took
      // the whole request down with a 500.
      await manager.query(`SELECT set_config('app.user_id', $1, true)`, [patientId]);

      const study = await manager
        .getRepository(Study)
        .findOne({ where: { id: dto.studyId } });
      if (!study) throw new NotFoundException(`Study ${dto.studyId} not found`);
      if (study.status !== StudyStatus.APPROVED) {
        throw new UnprocessableEntityException('Study is not approved');
      }

      const grant = await manager
        .getRepository(ConsentGrant)
        .createQueryBuilder('cg')
        .where('cg.patient_id = :patientId', { patientId })
        .andWhere('cg.purpose = :purpose', { purpose: ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT })
        .andWhere('cg.status = :active', { active: ConsentStatus.ACTIVE })
        .andWhere('cg.deleted_at IS NULL')
        .getOne();
      if (!grant) {
        throw new UnprocessableEntityException('No active CLINICAL_RESEARCH_RECRUITMENT consent grant');
      }

      const existing = await manager
        .getRepository(StudyEnrollment)
        .createQueryBuilder('se')
        .where('se.patient_id = :patientId', { patientId })
        .andWhere('se.study_id = :studyId', { studyId: dto.studyId })
        .andWhere('se.status != :withdrawn', { withdrawn: StudyEnrollmentStatus.WITHDRAWN })
        .andWhere('se.deleted_at IS NULL')
        .getOne();
      if (existing) {
        throw new ConflictException('Patient already has an active interest or enrollment in this study');
      }

      const sharedDataSnapshot = this.buildSnapshot(
        patient,
        SNAPSHOT_FIELDS[ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT],
      );
      const studyEnrollment = manager.getRepository(StudyEnrollment).create({
        patientId,
        studyId: dto.studyId,
        consentGrantId: grant.id,
        status: StudyEnrollmentStatus.INTERESTED,
        sharedDataSnapshot,
        directContactShared: dto.shareDirectContact ?? false,
      });
      return manager.getRepository(StudyEnrollment).save(studyEnrollment);
    });
  }

  async listMyEnrollments(
    userId: string,
    query: PaginationDto,
  ): Promise<{ enrollments: object[]; nextCursor?: string }> {
    const patientId = await this.resolvePatientId(userId);

    const qb = this.enrollmentRepo
      .createQueryBuilder('e')
      .leftJoin(Program, 'p', 'p.id = e.program_id')
      .leftJoin(Organization, 'o', 'o.id = p.org_id')
      .select([
        'e.id AS id',
        'e.program_id AS "programId"',
        'e.status AS status',
        'e.created_at AS "createdAt"',
        // The outcome of the NGO's review — what turns this list from "you applied"
        // into "here is what happened". Null until someone reviews it.
        'e.rejection_reason AS "rejectionReason"',
        'e.reviewed_at AS "reviewedAt"',
        'p.title AS "programTitle"',
        'p.type AS "programType"',
        'p.expires_at AS "programExpiresAt"',
        'o.name AS "orgName"',
      ])
      .where('e.patient_id = :patientId', { patientId })
      .andWhere('e.deleted_at IS NULL')
      .orderBy('e.id', 'ASC')
      .limit(query.limit + 1);

    if (query.cursor) {
      qb.andWhere('e.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { enrollments: rows, nextCursor };
  }

  async listMyStudyEnrollments(
    userId: string,
    query: PaginationDto,
  ): Promise<{ studyEnrollments: object[]; nextCursor?: string }> {
    const patientId = await this.resolvePatientId(userId);

    const qb = this.studyEnrollmentRepo
      .createQueryBuilder('se')
      .leftJoin(Study, 's', 's.id = se.study_id')
      .select([
        'se.id AS id',
        'se.study_id AS "studyId"',
        'se.status AS status',
        'se.created_at AS "createdAt"',
        's.title AS "studyTitle"',
        's.status AS "studyStatus"',
      ])
      .where('se.patient_id = :patientId', { patientId })
      .andWhere('se.status != :withdrawn', { withdrawn: StudyEnrollmentStatus.WITHDRAWN })
      .andWhere('se.deleted_at IS NULL')
      .orderBy('se.id', 'ASC')
      .limit(query.limit + 1);

    if (query.cursor) {
      qb.andWhere('se.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { studyEnrollments: rows, nextCursor };
  }

  async revokeByConsentGrant(consentGrantId: string, manager: EntityManager): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Enrollment)
      .set({ status: EnrollmentStatus.REVOKED_BY_PATIENT })
      .where('consent_grant_id = :id AND status = :active AND deleted_at IS NULL', {
        id: consentGrantId,
        active: EnrollmentStatus.ACTIVE,
      })
      .execute();

    await manager
      .createQueryBuilder()
      .update(StudyEnrollment)
      .set({ status: StudyEnrollmentStatus.WITHDRAWN })
      .where('consent_grant_id = :id AND status != :withdrawn AND deleted_at IS NULL', {
        id: consentGrantId,
        withdrawn: StudyEnrollmentStatus.WITHDRAWN,
      })
      .execute();
  }

  async advanceStudyEnrollment(id: string, newStatus: StudyEnrollmentStatus): Promise<StudyEnrollment> {
    const enrollment = await this.studyEnrollmentRepo.findOne({ where: { id } });
    if (!enrollment) throw new NotFoundException(`Study enrollment ${id} not found`);

    if (VALID_STUDY_TRANSITIONS[enrollment.status] !== newStatus) {
      throw new ConflictException(
        `Invalid state transition: ${enrollment.status} → ${newStatus}`,
      );
    }

    enrollment.status = newStatus;
    return this.studyEnrollmentRepo.save(enrollment);
  }

  buildSnapshot(patient: Patient, dataScopes: string[]): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const scope of dataScopes) {
      switch (scope) {
        case 'name':
          snapshot.name = patient.name;
          break;
        case 'conditionTags':
          snapshot.conditionTags = patient.conditionTags;
          break;
        case 'address':
          snapshot.address = patient.address ?? null;
          break;
        case 'directContactShared':
          snapshot.directContactShared = patient.directContactShared;
          break;
        case 'membershipNumber':
          snapshot.membershipNumber = patient.membershipNumber ?? null;
          break;
        case 'medicationList':
          snapshot.medicationList = patient.medicationList ?? [];
          break;
        // unknown scope fields are intentionally omitted
      }
    }
    return snapshot;
  }

  private async resolvePatientId(userId: string): Promise<string> {
    const patient = await this.patientRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.deleted_at IS NULL')
      .getOne();

    if (!patient) throw new NotFoundException('Patient profile not found');
    return patient.id;
  }
}
