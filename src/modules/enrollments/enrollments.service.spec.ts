import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

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
import { EnrollmentsService } from './enrollments.service';

// ── helpers ─────────────────────────────────────────────────────────────────

const makePatient = (overrides: Partial<Patient> = {}): Patient =>
  ({
    id: 'patient-id-000000000001',
    userId: 'user-id-0000000000001',
    name: 'Test Patient',
    phone: '+2348000000001',
    address: '1 Test St',
    conditionTags: ['diabetes', 'hypertension'],
    medicationList: [{ rxnormCode: 'RX123', name: 'Metformin' }],
    directContactShared: false,
    membershipNumber: 'HMO-001',
    deletedAt: undefined,
    ...overrides,
  } as unknown as Patient);

const makeProgram = (overrides: Partial<Program> = {}): Program =>
  ({
    id: 'program-id-000000000001',
    status: ProgramStatus.APPROVED,
    expiresAt: new Date(Date.now() + 86_400_000), // 1 day from now
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

const makeGrant = (overrides: Partial<ConsentGrant> = {}): ConsentGrant =>
  ({
    id: 'grant-id-0000000000001',
    patientId: 'patient-id-000000000001',
    purpose: ConsentPurpose.NGO_FUNDING,
    status: ConsentStatus.ACTIVE,
    dataScopes: SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING],
    ...overrides,
  } as unknown as ConsentGrant);

const makeEnrollment = (overrides: Partial<Enrollment> = {}): Enrollment =>
  ({
    id: 'enrollment-id-00000000001',
    patientId: 'patient-id-000000000001',
    programId: 'program-id-000000000001',
    consentGrantId: 'grant-id-0000000000001',
    status: EnrollmentStatus.ACTIVE,
    sharedDataSnapshot: {},
    ...overrides,
  } as unknown as Enrollment);

const makeStudyEnrollment = (overrides: Partial<StudyEnrollment> = {}): StudyEnrollment =>
  ({
    id: 'se-id-000000000000001',
    patientId: 'patient-id-000000000001',
    studyId: 'study-id-0000000000001',
    consentGrantId: 'grant-id-0000000000001',
    status: StudyEnrollmentStatus.INTERESTED,
    sharedDataSnapshot: {},
    directContactShared: false,
    ...overrides,
  } as unknown as StudyEnrollment);

// ── mock factory helpers ─────────────────────────────────────────────────────

function buildQbChain(result: unknown) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
    getCount: jest.fn().mockResolvedValue(0),
  };
  return qb;
}

function buildManagerMock({
  program,
  grant,
  existingEnrollment,
  study,
  existingStudyEnrollment,
  savedEntity,
}: {
  program?: Program | null;
  grant?: ConsentGrant | null;
  existingEnrollment?: Enrollment | null;
  study?: Study | null;
  existingStudyEnrollment?: StudyEnrollment | null;
  savedEntity?: unknown;
} = {}) {
  const mockQb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn()
      .mockResolvedValueOnce(grant ?? null)       // consent grant query
      .mockResolvedValueOnce(existingEnrollment ?? null), // existing enrollment query
  };

  const getRepositoryMock = jest.fn().mockImplementation((entity: any) => {
    if (entity === Program) return { findOne: jest.fn().mockResolvedValue(program ?? null) };
    if (entity === Study) return { findOne: jest.fn().mockResolvedValue(study ?? null) };
    if (entity === ConsentGrant) return { createQueryBuilder: jest.fn().mockReturnValue(mockQb) };
    if (entity === Enrollment) {
      return {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(existingEnrollment ?? null),
        }),
        create: jest.fn().mockReturnValue(savedEntity ?? {}),
        save: jest.fn().mockResolvedValue(savedEntity ?? {}),
      };
    }
    if (entity === StudyEnrollment) {
      return {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(existingStudyEnrollment ?? null),
        }),
        create: jest.fn().mockReturnValue(savedEntity ?? {}),
        save: jest.fn().mockResolvedValue(savedEntity ?? {}),
      };
    }
    return {};
  });

  const manager: Partial<EntityManager> = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: getRepositoryMock as any,
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    }),
  };

  return { manager, mockQb };
}

// ── test suite ───────────────────────────────────────────────────────────────

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  const mockEnrollmentRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockStudyEnrollmentRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockPatientRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockDataSource = { transaction: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: getRepositoryToken(Enrollment), useValue: mockEnrollmentRepo },
        { provide: getRepositoryToken(StudyEnrollment), useValue: mockStudyEnrollmentRepo },
        { provide: getRepositoryToken(Patient), useValue: mockPatientRepo },
        { provide: getRepositoryToken(Program), useValue: {} },
        { provide: getRepositoryToken(Study), useValue: {} },
        { provide: getRepositoryToken(ConsentGrant), useValue: {} },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
  });

  // ── buildSnapshot ──────────────────────────────────────────────────────────

  describe('buildSnapshot', () => {
    const patient = makePatient();

    it('maps NGO_FUNDING scopes correctly', () => {
      const result = service.buildSnapshot(patient, SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING]);
      expect(result).toEqual({
        name: 'Test Patient',
        conditionTags: ['diabetes', 'hypertension'],
        address: '1 Test St',
        directContactShared: false,
      });
    });

    it('maps CLINICAL_RESEARCH_RECRUITMENT scopes correctly', () => {
      const result = service.buildSnapshot(
        patient,
        SNAPSHOT_FIELDS[ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT],
      );
      expect(result).toEqual({
        name: 'Test Patient',
        conditionTags: ['diabetes', 'hypertension'],
        address: '1 Test St',
        directContactShared: false,
        medicationList: [{ rxnormCode: 'RX123', name: 'Metformin' }],
      });
    });

    it('maps HMO_CARE scopes correctly', () => {
      const result = service.buildSnapshot(patient, SNAPSHOT_FIELDS[ConsentPurpose.HMO_CARE]);
      expect(result).toEqual({
        name: 'Test Patient',
        conditionTags: ['diabetes', 'hypertension'],
        address: '1 Test St',
        membershipNumber: 'HMO-001',
        medicationList: [{ rxnormCode: 'RX123', name: 'Metformin' }],
      });
    });

    it('omits unknown scope fields', () => {
      const result = service.buildSnapshot(patient, ['name', 'unknownField'] as any);
      expect(result).toEqual({ name: 'Test Patient' });
      expect(result).not.toHaveProperty('unknownField');
    });

    it('falls back to null / empty array for optional fields', () => {
      const bare = makePatient({ address: undefined, medicationList: undefined, membershipNumber: undefined });
      const result = service.buildSnapshot(
        bare,
        SNAPSHOT_FIELDS[ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT],
      );
      expect(result.address).toBeNull();
      expect(result.medicationList).toEqual([]);
    });
  });

  // ── createEnrollment ───────────────────────────────────────────────────────

  describe('createEnrollment', () => {
    const userId = 'user-id-0000000000001';
    const dto = { programId: 'program-id-000000000001' };
    const patient = makePatient();
    const program = makeProgram();
    const grant = makeGrant();
    const saved = makeEnrollment();

    beforeEach(() => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(patient));
      mockPatientRepo.findOne.mockResolvedValue(patient);
    });

    it('creates and returns an enrollment (happy path)', async () => {
      const { manager } = buildManagerMock({ program, grant, savedEntity: saved });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));

      const result = await service.createEnrollment(userId, dto);
      expect(result).toBe(saved);
      expect(manager.query).toHaveBeenCalledWith('SET LOCAL "app.user_id" = $1', [patient.id]);
    });

    it('throws 404 when patient profile not found', async () => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(null));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when program not found', async () => {
      const { manager } = buildManagerMock({ program: null, grant });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 422 when program is not APPROVED', async () => {
      const { manager } = buildManagerMock({
        program: makeProgram({ status: ProgramStatus.PENDING_REVIEW }),
        grant,
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws 422 when program has expired', async () => {
      const { manager } = buildManagerMock({
        program: makeProgram({ expiresAt: new Date(Date.now() - 1000) }),
        grant,
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws 422 when no active consent grant', async () => {
      const { manager } = buildManagerMock({ program, grant: null });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws 409 when active enrollment already exists', async () => {
      const { manager } = buildManagerMock({
        program,
        grant,
        existingEnrollment: makeEnrollment(),
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createEnrollment(userId, dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── getEnrollment ──────────────────────────────────────────────────────────

  describe('getEnrollment', () => {
    const userId = 'user-id-0000000000001';
    const patient = makePatient();
    const enrollment = makeEnrollment();

    beforeEach(() => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(patient));
    });

    it('returns the enrollment when owner matches', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      const result = await service.getEnrollment(enrollment.id, userId);
      expect(result).toBe(enrollment);
    });

    it('throws 404 when enrollment not found', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      await expect(service.getEnrollment('nonexistent', userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 403 when patientId does not match', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(
        makeEnrollment({ patientId: 'different-patient-id' }),
      );
      await expect(service.getEnrollment(enrollment.id, userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ── createStudyEnrollment ──────────────────────────────────────────────────

  describe('createStudyEnrollment', () => {
    const userId = 'user-id-0000000000001';
    const dto = { studyId: 'study-id-0000000000001', shareDirectContact: true };
    const patient = makePatient();
    const study = makeStudy();
    const grant = makeGrant({ purpose: ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT });
    const saved = makeStudyEnrollment({ directContactShared: true });

    beforeEach(() => {
      mockPatientRepo.createQueryBuilder.mockReturnValue(buildQbChain(patient));
      mockPatientRepo.findOne.mockResolvedValue(patient);
    });

    it('creates and returns a study enrollment (happy path)', async () => {
      const { manager } = buildManagerMock({ study, grant, savedEntity: saved });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      const result = await service.createStudyEnrollment(userId, dto);
      expect(result).toBe(saved);
    });

    it('defaults directContactShared to false when not provided', async () => {
      let capturedCreateArg: any;
      const { manager } = buildManagerMock({ study, grant, savedEntity: makeStudyEnrollment() });
      // Override the StudyEnrollment repo create to capture its argument
      (manager.getRepository as jest.Mock).mockImplementation((entity: any) => {
        if (entity === Study) return { findOne: jest.fn().mockResolvedValue(study) };
        if (entity === ConsentGrant) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue(buildQbChain(grant)),
          };
        }
        if (entity === StudyEnrollment) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(null),
            }),
            create: jest.fn().mockImplementation((arg: any) => { capturedCreateArg = arg; return arg; }),
            save: jest.fn().mockResolvedValue(makeStudyEnrollment()),
          };
        }
        return {};
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));

      await service.createStudyEnrollment(userId, { studyId: dto.studyId, shareDirectContact: false });
      expect(capturedCreateArg).toMatchObject({ directContactShared: false });
    });

    it('throws 404 when study not found', async () => {
      const { manager } = buildManagerMock({ study: null, grant });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createStudyEnrollment(userId, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 422 when study is not APPROVED', async () => {
      const { manager } = buildManagerMock({
        study: makeStudy({ status: StudyStatus.PENDING_REVIEW }),
        grant,
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createStudyEnrollment(userId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws 422 when no active consent grant', async () => {
      const { manager } = buildManagerMock({ study, grant: null });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createStudyEnrollment(userId, dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('throws 409 when non-WITHDRAWN study enrollment exists', async () => {
      const { manager } = buildManagerMock({
        study,
        grant,
        existingStudyEnrollment: makeStudyEnrollment({ status: StudyEnrollmentStatus.SCREENED }),
      });
      mockDataSource.transaction.mockImplementation((cb: Function) => cb(manager));
      await expect(service.createStudyEnrollment(userId, dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── revokeByConsentGrant ───────────────────────────────────────────────────

  describe('revokeByConsentGrant', () => {
    it('updates Enrollment and StudyEnrollment using the provided manager', async () => {
      const executeMock = jest.fn().mockResolvedValue({ affected: 2 });
      const qb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: executeMock,
      };
      const manager = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as unknown as EntityManager;

      await service.revokeByConsentGrant('grant-id-0000000000001', manager);

      expect(manager.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(qb.update).toHaveBeenCalledWith(Enrollment);
      expect(qb.update).toHaveBeenCalledWith(StudyEnrollment);
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it('does NOT open its own transaction', async () => {
      const qb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      const manager = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as unknown as EntityManager;

      await service.revokeByConsentGrant('grant-id-0000000000001', manager);

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  // ── advanceStudyEnrollment ─────────────────────────────────────────────────

  describe('advanceStudyEnrollment', () => {
    it('transitions INTERESTED → SCREENED', async () => {
      const se = makeStudyEnrollment({ status: StudyEnrollmentStatus.INTERESTED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(se);
      mockStudyEnrollmentRepo.save.mockResolvedValue({ ...se, status: StudyEnrollmentStatus.SCREENED });

      const result = await service.advanceStudyEnrollment(se.id, StudyEnrollmentStatus.SCREENED);
      expect(result.status).toBe(StudyEnrollmentStatus.SCREENED);
    });

    it('transitions SCREENED → ENROLLED', async () => {
      const se = makeStudyEnrollment({ status: StudyEnrollmentStatus.SCREENED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(se);
      mockStudyEnrollmentRepo.save.mockResolvedValue({ ...se, status: StudyEnrollmentStatus.ENROLLED });

      const result = await service.advanceStudyEnrollment(se.id, StudyEnrollmentStatus.ENROLLED);
      expect(result.status).toBe(StudyEnrollmentStatus.ENROLLED);
    });

    it('throws 409 for invalid transition INTERESTED → ENROLLED', async () => {
      const se = makeStudyEnrollment({ status: StudyEnrollmentStatus.INTERESTED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(se);
      await expect(
        service.advanceStudyEnrollment(se.id, StudyEnrollmentStatus.ENROLLED),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 409 when trying to advance past ENROLLED', async () => {
      const se = makeStudyEnrollment({ status: StudyEnrollmentStatus.ENROLLED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(se);
      await expect(
        service.advanceStudyEnrollment(se.id, StudyEnrollmentStatus.WITHDRAWN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 404 when study enrollment not found', async () => {
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.advanceStudyEnrollment('nonexistent', StudyEnrollmentStatus.SCREENED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
