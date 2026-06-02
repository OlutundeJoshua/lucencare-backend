import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { DataSource, EntityManager, OptimisticLockVersionMismatchError, Repository } from 'typeorm';
import { Queue } from 'bullmq';

import { AuditAction, ConsentPurpose, ConsentStatus, EnrollmentStatus, StudyEnrollmentStatus } from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { CONSENT_REVOKED_JOB, NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';

import { ConsentGrant } from './entities/consent-grant.entity';
import { CreateConsentGrantDto } from './dto/create-consent-grant.dto';
import { UpdateConsentDto } from './dto/update-consent.dto';

export interface ConsentImpact {
  affectedEnrollments: Array<{ id: string; programId: string; programTitle: string; status: EnrollmentStatus }>;
  affectedStudyEnrollments: Array<{ id: string; studyId: string; studyTitle: string; status: StudyEnrollmentStatus }>;
  totalAffected: number;
}

// Valid state machine transitions. All others throw ConflictException (BR-1, BR-2).
const VALID_TRANSITIONS: Partial<Record<ConsentStatus, ConsentStatus[]>> = {
  [ConsentStatus.PENDING]: [ConsentStatus.ACTIVE],
  [ConsentStatus.ACTIVE]: [ConsentStatus.PAUSED, ConsentStatus.REVOKED],
  [ConsentStatus.PAUSED]: [ConsentStatus.ACTIVE, ConsentStatus.REVOKED],
};

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(ConsentGrant)
    private readonly consentGrantRepo: Repository<ConsentGrant>,

    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    // Direct repo injection avoids circular dep with EnrollmentsModule (which imports ConsentsModule).
    // Migrate to EnrollmentsService.revokeByConsentGrant(id, manager) with forwardRef() when
    // EnrollmentsModule is fully implemented.
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    @InjectRepository(StudyEnrollment)
    private readonly studyEnrollmentRepo: Repository<StudyEnrollment>,

    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,

    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Called by AuthService inside the patient registration transaction.
   * Creates an active grant with the full canonical scope for the given purpose (BR-10).
   */
  async createInitial(patientId: string, purpose: ConsentPurpose, manager: EntityManager): Promise<ConsentGrant> {
    const repo = manager.getRepository(ConsentGrant);
    const grant = repo.create({
      patientId,
      purpose,
      dataScopes: SNAPSHOT_FIELDS[purpose],
      status: ConsentStatus.ACTIVE,
      grantedAt: new Date(),
    });
    return repo.save(grant);
  }

  /**
   * Patient creates a new consent grant for an additional purpose.
   * Throws ConflictException if a non-revoked grant already exists for this purpose (BR-5).
   */
  async create(userId: string, dto: CreateConsentGrantDto): Promise<ConsentGrant> {
    const patientId = await this.resolvePatientId(userId);

    // BR-7: validate dataScopes against the canonical list for this purpose
    const canonical = SNAPSHOT_FIELDS[dto.purpose];
    const invalidScopes = dto.dataScopes.filter((s) => !canonical.includes(s));
    if (invalidScopes.length > 0) {
      throw new UnprocessableEntityException(
        `Invalid dataScopes for purpose ${dto.purpose}: ${invalidScopes.join(', ')}`,
      );
    }

    const existing = await this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId })
      .andWhere('cg.purpose = :purpose', { purpose: dto.purpose })
      .andWhere('cg.status != :revoked', { revoked: ConsentStatus.REVOKED })
      .andWhere('cg.deleted_at IS NULL')
      .getOne();

    if (existing) {
      throw new ConflictException('A non-revoked consent grant already exists for this purpose');
    }

    const grant = this.consentGrantRepo.create({
      patientId,
      purpose: dto.purpose,
      dataScopes: dto.dataScopes,
      status: ConsentStatus.ACTIVE,
      grantedAt: new Date(),
    });

    return this.consentGrantRepo.save(grant);
  }

  /**
   * Returns all consent grants for the patient, ordered by created_at DESC.
   * Includes all statuses (revoked included).
   */
  async getMyConsents(userId: string): Promise<ConsentGrant[]> {
    const patientId = await this.resolvePatientId(userId);

    return this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId })
      .andWhere('cg.deleted_at IS NULL')
      .orderBy('cg.created_at', 'DESC')
      .getMany();
  }

  /**
   * Validates and executes a state machine transition.
   * Delegates to revokeAndCascade when target status is REVOKED.
   * Uses optimistic locking via @VersionColumn (BR-4).
   */
  async transition(consentGrantId: string, userId: string, dto: UpdateConsentDto): Promise<ConsentGrant> {
    const patientId = await this.resolvePatientId(userId);

    // Load by ID only first so we can distinguish 404 vs 403 (BR-9)
    const grant = await this.consentGrantRepo.findOne({ where: { id: consentGrantId } });
    if (!grant) {
      throw new NotFoundException(`Consent grant ${consentGrantId} not found`);
    }

    if (grant.patientId !== patientId) {
      throw new ForbiddenException('Access denied: this consent grant does not belong to you');
    }

    const allowed = VALID_TRANSITIONS[grant.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new ConflictException(
        `Invalid state transition: ${grant.status} → ${dto.status}`,
      );
    }

    if (dto.status === ConsentStatus.REVOKED) {
      return this.revokeAndCascade(consentGrantId, patientId);
    }

    grant.status = dto.status;

    try {
      return await this.consentGrantRepo.save(grant);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException('Concurrent modification detected — please re-fetch and retry');
      }
      throw err;
    }
  }

  /**
   * Atomic revocation with cascade (BR-3). Runs inside a single transaction:
   * 1. SET LOCAL app.user_id for RLS
   * 2. Update consent_grants → REVOKED
   * 3. Tombstone active enrollments → REVOKED_BY_PATIENT
   * 4. Tombstone non-withdrawn study_enrollments → WITHDRAWN
   * Then (outside transaction):
   * 5. Audit log — wrapped in try/catch; AuditService.log is a stub until AuditModule is implemented
   * 6. Enqueue consent_revoked job
   */
  async revokeAndCascade(consentGrantId: string, patientId: string): Promise<ConsentGrant> {
    let revokedGrant: ConsentGrant;

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL "app.user_id" = $1', [patientId]);

      await manager
        .createQueryBuilder()
        .update(ConsentGrant)
        .set({ status: ConsentStatus.REVOKED, revokedAt: () => 'NOW()' })
        .where('id = :id AND patient_id = :patientId AND deleted_at IS NULL', { id: consentGrantId, patientId })
        .execute();

      await manager
        .createQueryBuilder()
        .update(Enrollment)
        .set({ status: EnrollmentStatus.REVOKED_BY_PATIENT })
        .where(
          'consent_grant_id = :id AND status = :active AND deleted_at IS NULL',
          { id: consentGrantId, active: EnrollmentStatus.ACTIVE },
        )
        .execute();

      await manager
        .createQueryBuilder()
        .update(StudyEnrollment)
        .set({ status: StudyEnrollmentStatus.WITHDRAWN })
        .where(
          'consent_grant_id = :id AND status != :withdrawn AND deleted_at IS NULL',
          { id: consentGrantId, withdrawn: StudyEnrollmentStatus.WITHDRAWN },
        )
        .execute();

      const reloaded = await manager.findOne(ConsentGrant, { where: { id: consentGrantId } });
      if (!reloaded) throw new NotFoundException(`Consent grant ${consentGrantId} not found after revoke`);
      revokedGrant = reloaded;
    });

    try {
      await this.auditService.log({
        actorId: patientId,
        action: AuditAction.REVOKE_CONSENT,
        resourceId: consentGrantId,
        resourceType: 'ConsentGrant',
        metadata: { patientId },
      });
    } catch (_) {
      // intentional no-op — AuditService.log stub throws; remove once AuditModule is implemented
    }

    await this.notificationsQueue.add(CONSENT_REVOKED_JOB, {
      consentGrantId,
      patientId,
      purpose: revokedGrant!.purpose,
    });

    return revokedGrant!;
  }

  /**
   * Returns the impact of revoking a consent grant without modifying any state (BR-8).
   */
  async getImpact(consentGrantId: string, userId: string): Promise<ConsentImpact> {
    const patientId = await this.resolvePatientId(userId);

    const grant = await this.consentGrantRepo.findOne({ where: { id: consentGrantId } });
    if (!grant) {
      throw new NotFoundException(`Consent grant ${consentGrantId} not found`);
    }
    if (grant.patientId !== patientId) {
      throw new ForbiddenException('Access denied: this consent grant does not belong to you');
    }

    const affectedEnrollments = await this.enrollmentRepo
      .createQueryBuilder('e')
      .innerJoin('programs', 'p', 'p.id = e.program_id')
      .select([
        'e.id as id',
        'e.program_id as "programId"',
        'p.title as "programTitle"',
        'e.status as status',
      ])
      .where('e.consent_grant_id = :id', { id: consentGrantId })
      .andWhere('e.status = :active', { active: EnrollmentStatus.ACTIVE })
      .andWhere('e.deleted_at IS NULL')
      .getRawMany();

    const affectedStudyEnrollments = await this.studyEnrollmentRepo
      .createQueryBuilder('se')
      .innerJoin('studies', 's', 's.id = se.study_id')
      .select([
        'se.id as id',
        'se.study_id as "studyId"',
        's.title as "studyTitle"',
        'se.status as status',
      ])
      .where('se.consent_grant_id = :id', { id: consentGrantId })
      .andWhere('se.status != :withdrawn', { withdrawn: StudyEnrollmentStatus.WITHDRAWN })
      .andWhere('se.deleted_at IS NULL')
      .getRawMany();

    return {
      affectedEnrollments,
      affectedStudyEnrollments,
      totalAffected: affectedEnrollments.length + affectedStudyEnrollments.length,
    };
  }

  /**
   * Utility — used by EnrollmentsModule before creating an enrollment.
   * Returns true if an ACTIVE consent grant exists for the given patient + purpose.
   */
  async hasActiveGrant(patientId: string, purpose: ConsentPurpose): Promise<boolean> {
    const count = await this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId })
      .andWhere('cg.purpose = :purpose', { purpose })
      .andWhere('cg.status = :active', { active: ConsentStatus.ACTIVE })
      .andWhere('cg.deleted_at IS NULL')
      .getCount();

    return count > 0;
  }

  /**
   * Returns the active consent grant for the given patient + purpose.
   * Used by EnrollmentsModule to link enrollment to consent grant.
   * Throws NotFoundException if no active grant exists.
   */
  async getActiveGrant(patientId: string, purpose: ConsentPurpose): Promise<ConsentGrant> {
    const grant = await this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId })
      .andWhere('cg.purpose = :purpose', { purpose })
      .andWhere('cg.status = :active', { active: ConsentStatus.ACTIVE })
      .andWhere('cg.deleted_at IS NULL')
      .getOne();

    if (!grant) {
      throw new NotFoundException(`No active consent grant found for purpose ${purpose}`);
    }

    return grant;
  }

  private async resolvePatientId(userId: string): Promise<string> {
    const patient = await this.patientRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.deleted_at IS NULL')
      .getOne();

    if (!patient) {
      throw new NotFoundException('Patient profile not found');
    }

    return patient.id;
  }
}
