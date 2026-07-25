import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ConsentPurpose, ConsentStatus, ProgramStatus, StudyStatus } from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';

import { EligibilityCriterion } from './interfaces/eligibility-criterion.interface';
import { MatchPreview } from './interfaces/match-preview.interface';
import { PaginatedPatientIds, PaginatedResult } from './interfaces/paginated-result.interface';

const MATCH_INDEX_TTL_SECONDS = 3600;
const ELIGIBLE_PAGE_SIZE = 200;

@Injectable()
export class MatchingService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,

    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,

    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(ConsentGrant)
    private readonly consentGrantRepo: Repository<ConsentGrant>,

    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async findMatchingPrograms(userId: string, query: PaginationDto): Promise<PaginatedResult<Program>> {
    const patientId = await this.resolvePatientId(userId);
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient profile not found');

    const { limit = 20, cursor } = query;

    const qb = this.programRepo
      .createQueryBuilder('p')
      .where('p.status = :approved', { approved: ProgramStatus.APPROVED })
      .andWhere('p.expires_at > NOW()')
      .andWhere('p.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM consent_grants cg
          WHERE cg.patient_id = :patientId
            AND cg.purpose = :purpose
            AND cg.status = :active
            AND cg.deleted_at IS NULL
        )`,
        { patientId, purpose: ConsentPurpose.NGO_FUNDING, active: ConsentStatus.ACTIVE },
      )
      .orderBy('p.id', 'ASC')
      .take(limit + 1);

    if (cursor) qb.andWhere('p.id > :cursor', { cursor });

    const rows = await qb.getMany();

    // Eligibility criteria vary per program row (dynamic JSONB); evaluated in JS after SQL fetch.
    // Consent check, status, and expiry are enforced above in SQL — eligibility is a matching heuristic.
    const filtered = rows.filter((prog) =>
      this.patientMatchesCriteria(patient, prog.eligibilityCriteria as EligibilityCriterion[]),
    );

    const hasMore = filtered.length > limit;
    if (hasMore) filtered.pop();
    return {
      data: filtered,
      nextCursor: hasMore ? filtered[filtered.length - 1].id : undefined,
    };
  }

  async findStudies(userId: string, query: PaginationDto): Promise<PaginatedResult<Study>> {
    const patientId = await this.resolvePatientId(userId);
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient profile not found');

    const { limit = 20, cursor } = query;

    const qb = this.studyRepo
      .createQueryBuilder('s')
      .where('s.status = :approved', { approved: StudyStatus.APPROVED })
      .andWhere('s.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM consent_grants cg
          WHERE cg.patient_id = :patientId
            AND cg.purpose = :purpose
            AND cg.status = :active
            AND cg.deleted_at IS NULL
        )`,
        {
          patientId,
          purpose: ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT,
          active: ConsentStatus.ACTIVE,
        },
      )
      .orderBy('s.id', 'ASC')
      .take(limit + 1);

    if (cursor) qb.andWhere('s.id > :cursor', { cursor });

    const rows = await qb.getMany();

    const filtered = rows.filter((study) =>
      this.patientMatchesCriteria(patient, study.eligibilityCriteria as EligibilityCriterion[]),
    );

    const hasMore = filtered.length > limit;
    if (hasMore) filtered.pop();
    return {
      data: filtered,
      nextCursor: hasMore ? filtered[filtered.length - 1].id : undefined,
    };
  }

  async indexProgram(programId: string): Promise<void> {
    const program = await this.programRepo.findOne({ where: { id: programId } });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);

    const criteria = program.eligibilityCriteria as EligibilityCriterion[];

    const countQb = this.patientRepo.createQueryBuilder('p').where('p.deleted_at IS NULL');
    this.buildCriteriaWhere(criteria, 'p', countQb);
    const eligibleCount = await countQb.getCount();

    const tagRows: Array<{ tag: string; count: string }> = await this.patientRepo.manager.query(
      `SELECT t.tag, COUNT(p.id)::int AS count
       FROM patients p, unnest(p.condition_tags) AS t(tag)
       WHERE p.deleted_at IS NULL
       GROUP BY t.tag`,
    );
    const tagSummary: Record<string, number> = {};
    for (const row of tagRows) {
      tagSummary[row.tag] = Number(row.count);
    }

    await this.redis.setex(this.programCountKey(programId), MATCH_INDEX_TTL_SECONDS, String(eligibleCount));
    await this.redis.setex(this.programTagsKey(programId), MATCH_INDEX_TTL_SECONDS, JSON.stringify(tagSummary));
  }

  async indexStudy(studyId: string): Promise<void> {
    const study = await this.studyRepo.findOne({ where: { id: studyId } });
    if (!study) throw new NotFoundException(`Study ${studyId} not found`);

    const criteria = study.eligibilityCriteria as EligibilityCriterion[];

    const countQb = this.patientRepo.createQueryBuilder('p').where('p.deleted_at IS NULL');
    this.buildCriteriaWhere(criteria, 'p', countQb);
    const eligibleCount = await countQb.getCount();

    const tagRows: Array<{ tag: string; count: string }> = await this.patientRepo.manager.query(
      `SELECT t.tag, COUNT(p.id)::int AS count
       FROM patients p, unnest(p.condition_tags) AS t(tag)
       WHERE p.deleted_at IS NULL
       GROUP BY t.tag`,
    );
    const tagSummary: Record<string, number> = {};
    for (const row of tagRows) {
      tagSummary[row.tag] = Number(row.count);
    }

    await this.redis.setex(this.studyCountKey(studyId), MATCH_INDEX_TTL_SECONDS, String(eligibleCount));
    await this.redis.setex(this.studyTagsKey(studyId), MATCH_INDEX_TTL_SECONDS, JSON.stringify(tagSummary));
  }

  async getMatchPreview(programId: string): Promise<MatchPreview> {
    const [countRaw, tagsRaw] = await Promise.all([
      this.redis.get(this.programCountKey(programId)),
      this.redis.get(this.programTagsKey(programId)),
    ]);

    if (countRaw !== null && tagsRaw !== null) {
      return { eligibleCount: parseInt(countRaw, 10), tagSummary: JSON.parse(tagsRaw) };
    }

    await this.indexProgram(programId);

    const [freshCount, freshTags] = await Promise.all([
      this.redis.get(this.programCountKey(programId)),
      this.redis.get(this.programTagsKey(programId)),
    ]);

    return {
      eligibleCount: parseInt(freshCount!, 10),
      tagSummary: JSON.parse(freshTags!),
    };
  }

  /** @deprecated Use getMatchPreview — kept for callers pre-dating the rename */
  async getProgramMatchPreview(programId: string): Promise<MatchPreview> {
    return this.getMatchPreview(programId);
  }

  async getStudyMatchPreview(studyId: string): Promise<MatchPreview> {
    const [countRaw, tagsRaw] = await Promise.all([
      this.redis.get(this.studyCountKey(studyId)),
      this.redis.get(this.studyTagsKey(studyId)),
    ]);

    if (countRaw !== null && tagsRaw !== null) {
      return { eligibleCount: parseInt(countRaw, 10), tagSummary: JSON.parse(tagsRaw) };
    }

    await this.indexStudy(studyId);

    const [freshCount, freshTags] = await Promise.all([
      this.redis.get(this.studyCountKey(studyId)),
      this.redis.get(this.studyTagsKey(studyId)),
    ]);

    return {
      eligibleCount: parseInt(freshCount!, 10),
      tagSummary: JSON.parse(freshTags!),
    };
  }

  async getEligiblePatientIds(programId: string, cursor?: string): Promise<PaginatedPatientIds> {
    const program = await this.programRepo.findOne({ where: { id: programId } });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);

    const criteria = program.eligibilityCriteria as EligibilityCriterion[];

    const qb = this.patientRepo
      .createQueryBuilder('p')
      .select('p.id')
      .where('p.deleted_at IS NULL')
      .orderBy('p.id', 'ASC')
      .take(ELIGIBLE_PAGE_SIZE + 1);

    if (cursor) qb.andWhere('p.id > :cursor', { cursor });
    this.buildCriteriaWhere(criteria, 'p', qb);

    const rows = await qb.getMany();
    const hasMore = rows.length > ELIGIBLE_PAGE_SIZE;
    if (hasMore) rows.pop();

    return {
      patientIds: rows.map((p) => p.id),
      nextCursor: hasMore ? rows[rows.length - 1].id : undefined,
    };
  }

  buildCriteriaWhere(
    criteria: EligibilityCriterion[],
    alias: string,
    qb: SelectQueryBuilder<any>,
  ): void {
    for (let i = 0; i < criteria.length; i++) {
      const { field, operator, value } = criteria[i];
      const paramName = `crit_${i}_val`;

      if (field === 'conditionTags') {
        // Array overlap: patient has at least one of the specified condition tags
        const tags = Array.isArray(value) ? value : [value];
        qb.andWhere(`${alias}.condition_tags && ARRAY[:...${paramName}]`, { [paramName]: tags });
      } else if (field === 'medicationList') {
        // JSONB containment: patient's medication list contains the specified object
        qb.andWhere(`${alias}.medication_list @> :${paramName}::jsonb`, {
          [paramName]: JSON.stringify(value),
        });
      } else if (field === 'locationState' || field === 'locationLga') {
        // TODO: Patient entity has no locationState/locationLga columns yet — skip until added
      } else {
        // Generic column mapping for other fields
        const col = this.fieldToColumn(field);
        if (!col) continue;
        switch (operator) {
          case 'eq':
            qb.andWhere(`${alias}.${col} = :${paramName}`, { [paramName]: value });
            break;
          case 'gte':
            qb.andWhere(`${alias}.${col} >= :${paramName}`, { [paramName]: value });
            break;
          case 'lte':
            qb.andWhere(`${alias}.${col} <= :${paramName}`, { [paramName]: value });
            break;
          case 'in':
            qb.andWhere(`${alias}.${col} IN (:...${paramName})`, { [paramName]: value });
            break;
          case 'contains':
            qb.andWhere(`${alias}.${col} LIKE :${paramName}`, { [paramName]: `%${value}%` });
            break;
        }
      }
    }
  }

  private fieldToColumn(field: string): string | null {
    const map: Record<string, string> = {
      gender: 'gender',
      dateOfBirth: 'date_of_birth',
      membershipNumber: 'membership_number',
    };
    return map[field] ?? null;
  }

  private patientMatchesCriteria(patient: Patient, criteria: EligibilityCriterion[]): boolean {
    for (const { field, operator, value } of criteria) {
      if (field === 'conditionTags') {
        const tags = Array.isArray(value) ? value : [value];
        const matches = (patient.conditionTags ?? []).some((t) => tags.includes(t));
        if (!matches) return false;
      } else if (field === 'medicationList') {
        // Basic JSONB containment check in JS — mirrors the SQL @> operator
        const meds = patient.medicationList ?? [];
        const target = typeof value === 'object' ? value : {};
        const matches = meds.some((m) =>
          Object.entries(target as object).every(([k, v]) => (m as Record<string, unknown>)[k] === v),
        );
        if (!matches) return false;
      }
      // locationState/locationLga: no column on Patient yet — criteria ignored
    }
    return true;
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

  private programCountKey(id: string) { return `match:program:${id}:count`; }
  private programTagsKey(id: string) { return `match:program:${id}:tags`; }
  private studyCountKey(id: string) { return `match:study:${id}:count`; }
  private studyTagsKey(id: string) { return `match:study:${id}:tags`; }
}
