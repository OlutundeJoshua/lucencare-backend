import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  ConsentPurpose,
  ConsentStatus,
  EnrollmentStatus,
  ProgramStatus,
  StudyEnrollmentStatus,
  StudyStatus,
} from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';

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
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,

    @InjectRepository(StudyEnrollment)
    private readonly studyEnrollmentRepo: Repository<StudyEnrollment>,

    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    private readonly dataSource: DataSource,
  ) {}

  async createEnrollment(userId: string, dto: CreateEnrollmentDto): Promise<Enrollment> {
    const patientId = await this.resolvePatientId(userId);
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient profile not found');

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL "app.user_id" = $1', [patientId]);

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

      const existing = await manager
        .getRepository(Enrollment)
        .createQueryBuilder('e')
        .where('e.patient_id = :patientId', { patientId })
        .andWhere('e.program_id = :programId', { programId: dto.programId })
        .andWhere('e.status = :active', { active: EnrollmentStatus.ACTIVE })
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
      await manager.query('SET LOCAL "app.user_id" = $1', [patientId]);

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
