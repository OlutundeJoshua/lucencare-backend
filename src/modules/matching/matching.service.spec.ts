import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { SelectQueryBuilder } from 'typeorm';

import { ConsentPurpose, ProgramStatus, StudyStatus } from 'src/common/enums';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';

import { MatchingService } from './matching.service';
import { EligibilityCriterion } from './interfaces/eligibility-criterion.interface';

// ── helpers ─────────────────────────────────────────────────────────────────

const makePatient = (overrides: Partial<Patient> = {}): Patient =>
  ({
    id: 'patient-id-000000000001',
    userId: 'user-id-0000000000001',
    conditionTags: ['diabetes'],
    medicationList: [{ rxnormCode: 'RX1', name: 'Metformin' }],
    deletedAt: undefined,
    ...overrides,
  } as unknown as Patient);

const makeProgram = (overrides: Partial<Program> = {}): Program =>
  ({
    id: 'program-id-000000000001',
    status: ProgramStatus.APPROVED,
    expiresAt: new Date(Date.now() + 86_400_000),
    eligibilityCriteria: [],
    ...overrides,
  } as unknown as Program);

const makeStudy = (overrides: Partial<Study> = {}): Study =>
  ({
    id: 'study-id-0000000000001',
    status: StudyStatus.APPROVED,
    eligibilityCriteria: [],
    ...overrides,
  } as unknown as Study);

function buildQbChain(manyResult: unknown[] = [], oneResult: unknown = null) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(manyResult),
    getOne: jest.fn().mockResolvedValue(oneResult),
    getCount: jest.fn().mockResolvedValue(manyResult.length),
  };
  return qb;
}

// ── test suite ───────────────────────────────────────────────────────────────

describe('MatchingService', () => {
  let service: MatchingService;

  const mockProgramRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn(), manager: { query: jest.fn() } };
  const mockStudyRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const mockPatientRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { query: jest.fn() },
  };
  const mockConsentGrantRepo = {};
  const mockRedis = { get: jest.fn(), setex: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: getRepositoryToken(Program), useValue: mockProgramRepo },
        { provide: getRepositoryToken(Study), useValue: mockStudyRepo },
        { provide: getRepositoryToken(Patient), useValue: mockPatientRepo },
        { provide: getRepositoryToken(ConsentGrant), useValue: mockConsentGrantRepo },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  // ── buildCriteriaWhere ─────────────────────────────────────────────────────

  describe('buildCriteriaWhere', () => {
    let qb: SelectQueryBuilder<any>;

    beforeEach(() => {
      qb = buildQbChain() as unknown as SelectQueryBuilder<any>;
    });

    it('appends && (array overlap) WHERE for conditionTags with operator "in"', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'conditionTags', operator: 'in', value: ['diabetes', 'hypertension'] },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);
      expect((qb as any).andWhere).toHaveBeenCalledWith(
        'p.condition_tags && ARRAY[:...crit_0_val]',
        { crit_0_val: ['diabetes', 'hypertension'] },
      );
    });

    it('appends @> JSONB containment WHERE for medicationList with operator "contains"', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'medicationList', operator: 'contains', value: { rxnormCode: 'RX1' } },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);
      expect((qb as any).andWhere).toHaveBeenCalledWith(
        'p.medication_list @> :crit_0_val::jsonb',
        { crit_0_val: JSON.stringify({ rxnormCode: 'RX1' }) },
      );
    });

    it('appends multiple WHERE clauses for multiple criteria', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'conditionTags', operator: 'in', value: ['diabetes'] },
        { field: 'medicationList', operator: 'contains', value: { rxnormCode: 'RX1' } },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);
      expect((qb as any).andWhere).toHaveBeenCalledTimes(2);
    });

    // These were skipped while Patient had no location columns, which meant a
    // programme scoped to one state silently matched every patient on the platform.
    it('filters on locationState and locationLga', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'locationState', operator: 'eq', value: 'Lagos' },
        { field: 'locationLga', operator: 'eq', value: 'Ikeja' },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);

      expect((qb as any).andWhere).toHaveBeenCalledWith('p.location_state = :crit_0_val', {
        crit_0_val: 'Lagos',
      });
      expect((qb as any).andWhere).toHaveBeenCalledWith('p.location_lga = :crit_1_val', {
        crit_1_val: 'Ikeja',
      });
    });

    it('supports a multi-state criterion with operator "in"', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'locationState', operator: 'in', value: ['Lagos', 'Oyo'] },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);

      expect((qb as any).andWhere).toHaveBeenCalledWith('p.location_state IN (:...crit_0_val)', {
        crit_0_val: ['Lagos', 'Oyo'],
      });
    });

    it('handles eq operator for known generic fields', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'gender', operator: 'eq', value: 'FEMALE' },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);
      expect((qb as any).andWhere).toHaveBeenCalledWith(
        'p.gender = :crit_0_val',
        { crit_0_val: 'FEMALE' },
      );
    });

    it('skips unknown fields gracefully', () => {
      const criteria: EligibilityCriterion[] = [
        { field: 'unknownField', operator: 'eq', value: 'foo' },
      ];
      service.buildCriteriaWhere(criteria, 'p', qb);
      expect((qb as any).andWhere).not.toHaveBeenCalled();
    });
  });

  // ── getMatchPreview — cache hit ────────────────────────────────────────────

  describe('getMatchPreview', () => {
    const programId = 'program-id-000000000001';

    it('returns cached values without calling indexProgram (cache hit)', async () => {
      mockRedis.get
        .mockResolvedValueOnce('42')
        .mockResolvedValueOnce(JSON.stringify({ diabetes: 10 }));

      const indexSpy = jest.spyOn(service, 'indexProgram');
      const result = await service.getMatchPreview(programId);

      expect(indexSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ eligibleCount: 42, tagSummary: { diabetes: 10 } });
    });

    it('calls indexProgram on cache miss then returns parsed values', async () => {
      // First pair: cache miss
      mockRedis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // Second pair: after index
        .mockResolvedValueOnce('15')
        .mockResolvedValueOnce(JSON.stringify({ hypertension: 5 }));

      jest.spyOn(service, 'indexProgram').mockResolvedValue(undefined);

      const result = await service.getMatchPreview(programId);

      expect(service.indexProgram).toHaveBeenCalledWith(programId);
      expect(result).toEqual({ eligibleCount: 15, tagSummary: { hypertension: 5 } });
    });
  });

  // ── getStudyMatchPreview ───────────────────────────────────────────────────

  describe('getStudyMatchPreview', () => {
    const studyId = 'study-id-0000000000001';

    it('returns cached values without calling indexStudy (cache hit)', async () => {
      mockRedis.get
        .mockResolvedValueOnce('7')
        .mockResolvedValueOnce(JSON.stringify({ cancer: 3 }));

      const indexSpy = jest.spyOn(service, 'indexStudy');
      const result = await service.getStudyMatchPreview(studyId);

      expect(indexSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ eligibleCount: 7, tagSummary: { cancer: 3 } });
    });

    it('calls indexStudy on cache miss', async () => {
      mockRedis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('3')
        .mockResolvedValueOnce(JSON.stringify({ cancer: 3 }));

      jest.spyOn(service, 'indexStudy').mockResolvedValue(undefined);

      await service.getStudyMatchPreview(studyId);
      expect(service.indexStudy).toHaveBeenCalledWith(studyId);
    });
  });

  // ── getEligiblePatientIds — pagination ────────────────────────────────────

  describe('getEligiblePatientIds', () => {
    const programId = 'program-id-000000000001';
    const program = makeProgram();

    beforeEach(() => {
      mockProgramRepo.findOne.mockResolvedValue(program);
    });

    it('returns all IDs with no nextCursor when fewer than 200 patients', async () => {
      const patients = Array.from({ length: 10 }, (_, i) =>
        makePatient({ id: `patient-${String(i).padStart(20, '0')}` }),
      );
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(patients));

      const result = await service.getEligiblePatientIds(programId);

      expect(result.patientIds).toHaveLength(10);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns exactly 200 IDs with a nextCursor when 201 patients returned by DB', async () => {
      const patients = Array.from({ length: 201 }, (_, i) =>
        makePatient({ id: `patient-${String(i).padStart(20, '0')}` }),
      );
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(patients));

      const result = await service.getEligiblePatientIds(programId);

      expect(result.patientIds).toHaveLength(200);
      expect(result.nextCursor).toBe(patients[199].id);
    });

    it('includes cursor in the query when provided', async () => {
      const qb = buildQbChain([]);
      mockPatientRepo.createQueryBuilder.mockReturnValue(qb);
      mockProgramRepo.findOne.mockResolvedValue(program);

      await service.getEligiblePatientIds(programId, 'cursor-value');

      expect(qb.andWhere).toHaveBeenCalledWith('p.id > :cursor', { cursor: 'cursor-value' });
    });

    it('throws 404 when program not found', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);
      await expect(service.getEligiblePatientIds('nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── findMatchingPrograms ───────────────────────────────────────────────────

  describe('findMatchingPrograms', () => {
    const userId = 'user-id-0000000000001';
    const patient = makePatient();
    const programs = [makeProgram(), makeProgram({ id: 'program-id-000000000002' })];

    beforeEach(() => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain([patient], patient));
      mockPatientRepo.findOne.mockResolvedValue(patient);
    });

    it('builds QB with consent EXISTS subquery and APPROVED status filter', async () => {
      const qb = buildQbChain(programs);
      mockProgramRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findMatchingPrograms(userId, { limit: 20 });

      // Verify consent EXISTS subquery is included
      const andWhereCalls: string[] = (qb.andWhere as jest.Mock).mock.calls.map((c) => c[0]);
      const hasConsentCheck = andWhereCalls.some(
        (clause) => typeof clause === 'string' && clause.includes('consent_grants'),
      );
      expect(hasConsentCheck).toBe(true);

      // Verify status filter
      expect(qb.where).toHaveBeenCalledWith('p.status = :approved', { approved: ProgramStatus.APPROVED });
    });

    it('returns paginated programs and nextCursor when hasMore', async () => {
      const manyPrograms = Array.from({ length: 21 }, (_, i) =>
        makeProgram({ id: `program-${String(i).padStart(20, '0')}`, eligibilityCriteria: [] }),
      );
      const qb = buildQbChain(manyPrograms);
      mockProgramRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findMatchingPrograms(userId, { limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });

    it('throws 404 when patient profile not found', async () => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain([], null));
      await expect(service.findMatchingPrograms(userId, { limit: 20 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // The JS-side filter must agree with the SQL one, or a programme reads as
    // matching on one path and not the other.
    describe('location criteria, evaluated in JS', () => {
      const stateScoped = makeProgram({
        eligibilityCriteria: [{ field: 'locationState', operator: 'eq', value: 'Lagos' }],
      });

      function withPatient(patient: Patient) {
        mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain([patient], patient));
        mockPatientRepo.findOne.mockResolvedValue(patient);
        mockProgramRepo.createQueryBuilder.mockReturnValue(buildQbChain([stateScoped]));
      }

      it('matches a patient in the programme’s state', async () => {
        withPatient(makePatient({ locationState: 'Lagos' }));

        const result = await service.findMatchingPrograms(userId, { limit: 20 });

        expect(result.data).toHaveLength(1);
      });

      it('excludes a patient in a different state', async () => {
        withPatient(makePatient({ locationState: 'Kano' }));

        const result = await service.findMatchingPrograms(userId, { limit: 20 });

        expect(result.data).toHaveLength(0);
      });

      // Previously an unlocated patient matched every state-scoped programme.
      it('excludes a patient with no location recorded', async () => {
        withPatient(makePatient({ locationState: undefined }));

        const result = await service.findMatchingPrograms(userId, { limit: 20 });

        expect(result.data).toHaveLength(0);
      });
    });
  });

  // ── findStudies ────────────────────────────────────────────────────────────

  describe('findStudies', () => {
    const userId = 'user-id-0000000000001';
    const patient = makePatient();

    beforeEach(() => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain([patient], patient));
      mockPatientRepo.findOne.mockResolvedValue(patient);
    });

    it('builds QB with consent EXISTS subquery for CLINICAL_RESEARCH_RECRUITMENT', async () => {
      const qb = buildQbChain([makeStudy()]);
      mockStudyRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findStudies(userId, { limit: 20 });

      const andWhereCalls: string[] = (qb.andWhere as jest.Mock).mock.calls.map((c) => c[0]);
      const hasConsentCheck = andWhereCalls.some(
        (clause) => typeof clause === 'string' && clause.includes('consent_grants'),
      );
      expect(hasConsentCheck).toBe(true);

      const consentCallArgs = (qb.andWhere as jest.Mock).mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('consent_grants'),
      );
      expect(consentCallArgs?.[1]).toMatchObject({
        purpose: ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT,
      });
    });
  });
});
