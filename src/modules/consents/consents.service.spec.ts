import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource, OptimisticLockVersionMismatchError } from 'typeorm';

import { ConsentPurpose, ConsentStatus, EnrollmentStatus, StudyEnrollmentStatus } from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';

import { ConsentsService } from './consents.service';
import { ConsentGrant } from './entities/consent-grant.entity';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZU1';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZU2';
const GRANT_ID = '01HZZZZZZZZZZZZZZZZZZZZZU3';

const mockPatient: Partial<Patient> = { id: PATIENT_ID, userId: USER_ID };

const makeGrant = (overrides: Partial<ConsentGrant> = {}): ConsentGrant =>
  ({
    id: GRANT_ID,
    patientId: PATIENT_ID,
    purpose: ConsentPurpose.NGO_FUNDING,
    dataScopes: SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING],
    status: ConsentStatus.ACTIVE,
    grantedAt: new Date(),
    revokedAt: undefined,
    version: 1,
    ...overrides,
  } as ConsentGrant);

function makeQbMock(overrides: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
    getRawMany: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
  // make chainable methods return the qb object
  ['where', 'andWhere', 'orderBy', 'take', 'innerJoin', 'select', 'update', 'set'].forEach(
    (m) => { qb[m].mockReturnValue(qb); },
  );
  return qb;
}

describe('ConsentsService', () => {
  let service: ConsentsService;

  let mockConsentGrantRepo: Record<string, jest.Mock>;
  let mockPatientRepo: Record<string, jest.Mock>;
  let mockEnrollmentRepo: Record<string, jest.Mock>;
  let mockStudyEnrollmentRepo: Record<string, jest.Mock>;
  let mockDataSource: { transaction: jest.Mock };
  let mockAuditService: { log: jest.Mock };
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockConsentGrantRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    mockPatientRepo = { createQueryBuilder: jest.fn() };
    mockEnrollmentRepo = { createQueryBuilder: jest.fn() };
    mockStudyEnrollmentRepo = { createQueryBuilder: jest.fn() };
    mockDataSource = { transaction: jest.fn() };
    mockAuditService = { log: jest.fn().mockRejectedValue(new Error('Not implemented')) };
    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsentsService,
        { provide: getRepositoryToken(ConsentGrant), useValue: mockConsentGrantRepo },
        { provide: getRepositoryToken(Patient), useValue: mockPatientRepo },
        { provide: getRepositoryToken(Enrollment), useValue: mockEnrollmentRepo },
        { provide: getRepositoryToken(StudyEnrollment), useValue: mockStudyEnrollmentRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: AuditService, useValue: mockAuditService },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<ConsentsService>(ConsentsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createInitial
  // ---------------------------------------------------------------------------
  describe('createInitial', () => {
    it('creates an ACTIVE grant with full canonical scopes via provided manager', async () => {
      const grant = makeGrant();
      const mockRepo = { create: jest.fn().mockReturnValue(grant), save: jest.fn().mockResolvedValue(grant) };
      const mockManager = { getRepository: jest.fn().mockReturnValue(mockRepo) } as any;

      const result = await service.createInitial(PATIENT_ID, ConsentPurpose.NGO_FUNDING, mockManager);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: PATIENT_ID,
          purpose: ConsentPurpose.NGO_FUNDING,
          dataScopes: SNAPSHOT_FIELDS[ConsentPurpose.NGO_FUNDING],
          status: ConsentStatus.ACTIVE,
        }),
      );
      expect(result).toBe(grant);
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    const dto = {
      purpose: ConsentPurpose.NGO_FUNDING,
      dataScopes: ['name', 'conditionTags'],
    };

    beforeEach(() => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(mockPatient) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);
    });

    it('creates and returns a grant when dataScopes are valid and no existing grant', async () => {
      const existingQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(null) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(existingQb);
      const grant = makeGrant();
      mockConsentGrantRepo.create.mockReturnValue(grant);
      mockConsentGrantRepo.save.mockResolvedValue(grant);

      const result = await service.create(USER_ID, dto);

      expect(mockConsentGrantRepo.save).toHaveBeenCalled();
      expect(result).toBe(grant);
    });

    it('throws UnprocessableEntityException when dataScopes contain invalid fields', async () => {
      await expect(
        service.create(USER_ID, { ...dto, dataScopes: ['name', 'invalidField'] }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when a non-revoked grant already exists for this purpose', async () => {
      const existingQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(makeGrant()) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(existingQb);

      await expect(service.create(USER_ID, dto)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when patient profile not found', async () => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(null) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);

      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getMyConsents
  // ---------------------------------------------------------------------------
  describe('getMyConsents', () => {
    it('returns all grants ordered by created_at DESC', async () => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(mockPatient) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);

      const grants = [makeGrant(), makeGrant({ status: ConsentStatus.REVOKED })];
      const grantsQb = makeQbMock({ getMany: jest.fn().mockResolvedValue(grants) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(grantsQb);

      const result = await service.getMyConsents(USER_ID);

      expect(result).toEqual(grants);
      expect(grantsQb.orderBy).toHaveBeenCalledWith('cg.created_at', 'DESC');
    });

    it('returns empty array when patient has no grants', async () => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(mockPatient) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);

      const grantsQb = makeQbMock({ getMany: jest.fn().mockResolvedValue([]) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(grantsQb);

      const result = await service.getMyConsents(USER_ID);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // transition
  // ---------------------------------------------------------------------------
  describe('transition', () => {
    beforeEach(() => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(mockPatient) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);
    });

    it('transitions ACTIVE → PAUSED successfully', async () => {
      const grant = makeGrant({ status: ConsentStatus.ACTIVE });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);
      const updated = makeGrant({ status: ConsentStatus.PAUSED });
      mockConsentGrantRepo.save.mockResolvedValue(updated);

      const result = await service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.PAUSED });

      expect(mockConsentGrantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ConsentStatus.PAUSED }),
      );
      expect(result.status).toBe(ConsentStatus.PAUSED);
    });

    it('transitions PAUSED → ACTIVE successfully', async () => {
      const grant = makeGrant({ status: ConsentStatus.PAUSED });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);
      const updated = makeGrant({ status: ConsentStatus.ACTIVE });
      mockConsentGrantRepo.save.mockResolvedValue(updated);

      const result = await service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.ACTIVE });

      expect(result.status).toBe(ConsentStatus.ACTIVE);
    });

    it('transitions PENDING → ACTIVE successfully', async () => {
      const grant = makeGrant({ status: ConsentStatus.PENDING });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);
      const updated = makeGrant({ status: ConsentStatus.ACTIVE });
      mockConsentGrantRepo.save.mockResolvedValue(updated);

      await service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.ACTIVE });

      expect(mockConsentGrantRepo.save).toHaveBeenCalled();
    });

    it('delegates ACTIVE → REVOKED to revokeAndCascade', async () => {
      const grant = makeGrant({ status: ConsentStatus.ACTIVE });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);

      const revokeSpy = jest.spyOn(service, 'revokeAndCascade').mockResolvedValue(makeGrant({ status: ConsentStatus.REVOKED }));

      await service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.REVOKED });

      expect(revokeSpy).toHaveBeenCalledWith(GRANT_ID, PATIENT_ID);
    });

    it('delegates PAUSED → REVOKED to revokeAndCascade', async () => {
      const grant = makeGrant({ status: ConsentStatus.PAUSED });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);

      const revokeSpy = jest.spyOn(service, 'revokeAndCascade').mockResolvedValue(makeGrant({ status: ConsentStatus.REVOKED }));

      await service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.REVOKED });

      expect(revokeSpy).toHaveBeenCalledWith(GRANT_ID, PATIENT_ID);
    });

    it('throws ConflictException for REVOKED → ACTIVE (terminal state)', async () => {
      const grant = makeGrant({ status: ConsentStatus.REVOKED });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);

      await expect(
        service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.ACTIVE }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException for NOT_GRANTED → ACTIVE (invalid)', async () => {
      const grant = makeGrant({ status: ConsentStatus.NOT_GRANTED });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);

      await expect(
        service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.ACTIVE }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when grant does not exist', async () => {
      mockConsentGrantRepo.findOne.mockResolvedValue(null);

      await expect(
        service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.PAUSED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when grant belongs to another patient', async () => {
      const grant = makeGrant({ status: ConsentStatus.ACTIVE, patientId: 'other-patient-id-xxxxx' });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);

      await expect(
        service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.PAUSED }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException on OptimisticLockVersionMismatchError', async () => {
      const grant = makeGrant({ status: ConsentStatus.ACTIVE });
      mockConsentGrantRepo.findOne.mockResolvedValue(grant);
      mockConsentGrantRepo.save.mockRejectedValue(
        new OptimisticLockVersionMismatchError('consent_grants', 1, 2),
      );

      await expect(
        service.transition(GRANT_ID, USER_ID, { status: ConsentStatus.PAUSED }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // revokeAndCascade
  // ---------------------------------------------------------------------------
  describe('revokeAndCascade', () => {
    const revokedGrant = makeGrant({ status: ConsentStatus.REVOKED, revokedAt: new Date() });

    let mockManager: any;

    beforeEach(() => {
      const qb = makeQbMock();
      mockManager = {
        query: jest.fn().mockResolvedValue(undefined),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        findOne: jest.fn().mockResolvedValue(revokedGrant),
      };
      mockDataSource.transaction.mockImplementation(async (cb: (manager: any) => Promise<void>) => cb(mockManager));
    });

    it('executes all steps inside transaction and enqueues job', async () => {
      const result = await service.revokeAndCascade(GRANT_ID, PATIENT_ID);

      expect(mockManager.query).toHaveBeenCalledWith('SET LOCAL "app.user_id" = $1', [PATIENT_ID]);
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(3);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'consent_revoked',
        expect.objectContaining({ consentGrantId: GRANT_ID, patientId: PATIENT_ID }),
      );
      expect(result).toBe(revokedGrant);
    });

    it('still returns successfully even when auditService.log stub throws', async () => {
      mockAuditService.log.mockRejectedValue(new Error('Not implemented'));

      const result = await service.revokeAndCascade(GRANT_ID, PATIENT_ID);

      expect(result).toBe(revokedGrant);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('does not enqueue job when transaction throws', async () => {
      mockDataSource.transaction.mockRejectedValue(new Error('DB error'));

      await expect(service.revokeAndCascade(GRANT_ID, PATIENT_ID)).rejects.toThrow('DB error');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getImpact
  // ---------------------------------------------------------------------------
  describe('getImpact', () => {
    beforeEach(() => {
      const patientQb = makeQbMock({ getOne: jest.fn().mockResolvedValue(mockPatient) });
      mockPatientRepo.createQueryBuilder.mockReturnValue(patientQb);
    });

    it('returns impact shape with affectedEnrollments and affectedStudyEnrollments', async () => {
      mockConsentGrantRepo.findOne.mockResolvedValue(makeGrant());

      const enrollmentRows = [{ id: 'e1', programId: 'p1', programTitle: 'Program A', status: EnrollmentStatus.ACTIVE }];
      const studyRows = [{ id: 'se1', studyId: 's1', studyTitle: 'Study X', status: StudyEnrollmentStatus.ENROLLED }];

      const enrollQb = makeQbMock({ getRawMany: jest.fn().mockResolvedValue(enrollmentRows) });
      const studyQb = makeQbMock({ getRawMany: jest.fn().mockResolvedValue(studyRows) });
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(enrollQb);
      mockStudyEnrollmentRepo.createQueryBuilder.mockReturnValue(studyQb);

      const result = await service.getImpact(GRANT_ID, USER_ID);

      expect(result.affectedEnrollments).toEqual(enrollmentRows);
      expect(result.affectedStudyEnrollments).toEqual(studyRows);
      expect(result.totalAffected).toBe(2);
    });

    it('returns totalAffected = 0 when no enrollments are linked', async () => {
      mockConsentGrantRepo.findOne.mockResolvedValue(makeGrant());

      const emptyQb = makeQbMock({ getRawMany: jest.fn().mockResolvedValue([]) });
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(emptyQb);
      mockStudyEnrollmentRepo.createQueryBuilder.mockReturnValue(emptyQb);

      const result = await service.getImpact(GRANT_ID, USER_ID);

      expect(result.totalAffected).toBe(0);
    });

    it('throws NotFoundException when grant does not exist', async () => {
      mockConsentGrantRepo.findOne.mockResolvedValue(null);

      await expect(service.getImpact(GRANT_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when grant belongs to another patient', async () => {
      mockConsentGrantRepo.findOne.mockResolvedValue(makeGrant({ patientId: 'other-patient-xxxxx' }));

      await expect(service.getImpact(GRANT_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // hasActiveGrant
  // ---------------------------------------------------------------------------
  describe('hasActiveGrant', () => {
    it('returns true when an active grant exists', async () => {
      const qb = makeQbMock({ getCount: jest.fn().mockResolvedValue(1) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.hasActiveGrant(PATIENT_ID, ConsentPurpose.NGO_FUNDING)).toBe(true);
    });

    it('returns false when no active grant exists', async () => {
      const qb = makeQbMock({ getCount: jest.fn().mockResolvedValue(0) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.hasActiveGrant(PATIENT_ID, ConsentPurpose.NGO_FUNDING)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveGrant
  // ---------------------------------------------------------------------------
  describe('getActiveGrant', () => {
    it('returns the active grant when found', async () => {
      const grant = makeGrant();
      const qb = makeQbMock({ getOne: jest.fn().mockResolvedValue(grant) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getActiveGrant(PATIENT_ID, ConsentPurpose.NGO_FUNDING);

      expect(result).toBe(grant);
    });

    it('throws NotFoundException when no active grant exists', async () => {
      const qb = makeQbMock({ getOne: jest.fn().mockResolvedValue(null) });
      mockConsentGrantRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.getActiveGrant(PATIENT_ID, ConsentPurpose.NGO_FUNDING),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
