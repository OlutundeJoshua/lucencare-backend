import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';

import { OrgStatus, OrgType, ProgramStatus, ProgramType } from 'src/common/enums';
import { ADMIN_QUEUE, NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { MatchingService } from 'src/modules/matching/matching.service';

import { Program } from './entities/program.entity';
import { ProgramsService } from './programs.service';
import { ListProgramsDto } from './dto/list-programs.dto';

const PROGRAM_ID = '01HZZZZZZZZZZZZZZZZZZZZPGM';
const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZORG';
const ENROLLMENT_ID = '01HZZZZZZZZZZZZZZZZZZZZENR';

const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();
const PAST_DATE = new Date(Date.now() - 86_400_000).toISOString();

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  const org = new Organization();
  org.id = ORG_ID;
  org.name = 'Test NGO';
  org.type = OrgType.NGO;
  org.status = OrgStatus.ACTIVE;
  org.contactEmail = 'ngo@test.com';
  return Object.assign(org, overrides);
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  const p = new Program();
  p.id = PROGRAM_ID;
  p.orgId = ORG_ID;
  p.title = 'Test Program';
  p.type = ProgramType.NGO_FUNDING;
  p.status = ProgramStatus.PENDING_REVIEW;
  p.eligibilityCriteria = [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }];
  p.expiresAt = new Date(Date.now() + 86_400_000);
  p.createdAt = new Date();
  return Object.assign(p, overrides);
}

const mockProgramQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockEnrollmentQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockProgramRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => mockProgramQb),
};

const mockOrgRepo = {
  findOne: jest.fn(),
};

const mockEnrollmentRepo = {
  createQueryBuilder: jest.fn(() => mockEnrollmentQb),
};

const mockMatchingService = {
  getProgramMatchPreview: jest.fn(),
  indexProgram: jest.fn(),
};

const mockAdminQueue = { add: jest.fn() };
const mockNotificationsQueue = { add: jest.fn() };

describe('ProgramsService', () => {
  let service: ProgramsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgramsService,
        { provide: getRepositoryToken(Program), useValue: mockProgramRepo },
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        { provide: getRepositoryToken(Enrollment), useValue: mockEnrollmentRepo },
        { provide: MatchingService, useValue: mockMatchingService },
        { provide: getQueueToken(ADMIN_QUEUE), useValue: mockAdminQueue },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: mockNotificationsQueue },
      ],
    }).compile();

    service = module.get<ProgramsService>(ProgramsService);
    jest.clearAllMocks();
    mockProgramQb.where.mockReturnThis();
    mockProgramQb.andWhere.mockReturnThis();
    mockProgramQb.orderBy.mockReturnThis();
    mockProgramQb.take.mockReturnThis();
    mockEnrollmentQb.where.mockReturnThis();
    mockEnrollmentQb.andWhere.mockReturnThis();
    mockEnrollmentQb.orderBy.mockReturnThis();
    mockEnrollmentQb.take.mockReturnThis();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    const dto = {
      title: 'Test Program',
      type: ProgramType.NGO_FUNDING,
      eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq' as const, value: 'diabetes' }],
      expiresAt: FUTURE_DATE,
    };

    it('creates and returns program with PENDING_REVIEW status', async () => {
      const org = makeOrg();
      const program = makeProgram({ status: ProgramStatus.PENDING_REVIEW });
      mockOrgRepo.findOne.mockResolvedValue(org);
      mockProgramRepo.create.mockReturnValue(program);
      mockProgramRepo.save.mockResolvedValue(program);
      mockAdminQueue.add.mockResolvedValue(undefined);

      const result = await service.create(ORG_ID, dto);

      expect(mockProgramRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: ORG_ID, status: ProgramStatus.PENDING_REVIEW }),
      );
      expect(mockProgramRepo.save).toHaveBeenCalledWith(program);
      expect(result.status).toBe(ProgramStatus.PENDING_REVIEW);
    });

    it('enqueues program_review job after creation', async () => {
      const org = makeOrg();
      const program = makeProgram();
      mockOrgRepo.findOne.mockResolvedValue(org);
      mockProgramRepo.create.mockReturnValue(program);
      mockProgramRepo.save.mockResolvedValue(program);
      mockAdminQueue.add.mockResolvedValue(undefined);

      await service.create(ORG_ID, dto);

      expect(mockAdminQueue.add).toHaveBeenCalledWith(
        'program_review',
        expect.objectContaining({ programId: program.id, orgId: ORG_ID }),
      );
    });

    it('throws NotFoundException when org not found', async () => {
      mockOrgRepo.findOne.mockResolvedValue(null);

      await expect(service.create(ORG_ID, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when org is pending_verification', async () => {
      mockOrgRepo.findOne.mockResolvedValue(makeOrg({ status: OrgStatus.PENDING_VERIFICATION }));

      await expect(service.create(ORG_ID, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when org is suspended', async () => {
      mockOrgRepo.findOne.mockResolvedValue(makeOrg({ status: OrgStatus.SUSPENDED }));

      await expect(service.create(ORG_ID, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws UnprocessableEntityException when type is not NGO_FUNDING', async () => {
      mockOrgRepo.findOne.mockResolvedValue(makeOrg());

      await expect(
        service.create(ORG_ID, { ...dto, type: ProgramType.RESEARCH_STUDY }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when expiresAt is in the past', async () => {
      mockOrgRepo.findOne.mockResolvedValue(makeOrg());

      await expect(
        service.create(ORG_ID, { ...dto, expiresAt: PAST_DATE }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ---------------------------------------------------------------------------
  // findByOrg
  // ---------------------------------------------------------------------------

  describe('findByOrg', () => {
    it('returns paginated programs with nextCursor when more rows exist', async () => {
      const programs = Array.from({ length: 21 }, (_, i) =>
        makeProgram({ id: `PGM${i.toString().padStart(23, '0')}` }),
      );
      mockProgramQb.getMany.mockResolvedValue(programs);

      const result = await service.findByOrg(ORG_ID, { limit: 20 } as ListProgramsDto);

      expect(result.programs).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });

    it('returns programs with no nextCursor on last page', async () => {
      mockProgramQb.getMany.mockResolvedValue([makeProgram()]);

      const result = await service.findByOrg(ORG_ID, { limit: 20 } as ListProgramsDto);

      expect(result.programs).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('applies status filter when provided', async () => {
      mockProgramQb.getMany.mockResolvedValue([]);

      await service.findByOrg(ORG_ID, { status: ProgramStatus.APPROVED } as ListProgramsDto);

      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.status = :status', {
        status: ProgramStatus.APPROVED,
      });
    });

    it('applies cursor filter when provided', async () => {
      mockProgramQb.getMany.mockResolvedValue([]);

      await service.findByOrg(ORG_ID, { cursor: PROGRAM_ID } as ListProgramsDto);

      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.id > :cursor', {
        cursor: PROGRAM_ID,
      });
    });

    it('returns empty array when no programs match', async () => {
      mockProgramQb.getMany.mockResolvedValue([]);

      const result = await service.findByOrg(ORG_ID, {} as ListProgramsDto);

      expect(result.programs).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // findByIdForOrg
  // ---------------------------------------------------------------------------

  describe('findByIdForOrg', () => {
    it('returns program when found and org matches', async () => {
      const program = makeProgram();
      mockProgramRepo.findOne.mockResolvedValue(program);

      const result = await service.findByIdForOrg(PROGRAM_ID, ORG_ID);

      expect(result).toBe(program);
    });

    it('throws NotFoundException when program not found', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);

      await expect(service.findByIdForOrg(PROGRAM_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when orgId does not match', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());

      await expect(
        service.findByIdForOrg(PROGRAM_ID, 'DIFFERENT_ORG_ZZZZZZZZZ'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // getMatchPreview
  // ---------------------------------------------------------------------------

  describe('getMatchPreview', () => {
    it('returns aggregate preview from MatchingService', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      const preview = { eligibleCount: 42, tagSummary: { diabetes: 30, hypertension: 12 } };
      mockMatchingService.getProgramMatchPreview.mockResolvedValue(preview);

      const result = await service.getMatchPreview(PROGRAM_ID, ORG_ID);

      expect(mockMatchingService.getProgramMatchPreview).toHaveBeenCalledWith(PROGRAM_ID);
      expect(result).toEqual(preview);
    });

    it('throws ForbiddenException when program belongs to different org', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());

      await expect(
        service.getMatchPreview(PROGRAM_ID, 'OTHER_ORG_ZZZZZZZZZZZZ'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when program not found', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);

      await expect(service.getMatchPreview(PROGRAM_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getEnrollments
  // ---------------------------------------------------------------------------

  describe('getEnrollments', () => {
    it('returns enrollment snapshots without patient IDs', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());

      const enrollment = new Enrollment();
      enrollment.id = ENROLLMENT_ID;
      enrollment.programId = PROGRAM_ID;
      enrollment.status = 'active' as any;
      enrollment.sharedDataSnapshot = { conditionTags: ['diabetes'] };
      enrollment.createdAt = new Date();
      mockEnrollmentQb.getMany.mockResolvedValue([enrollment]);

      const result = await service.getEnrollments(PROGRAM_ID, ORG_ID, { limit: 20 });

      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0]).toEqual(
        expect.objectContaining({
          id: ENROLLMENT_ID,
          sharedDataSnapshot: { conditionTags: ['diabetes'] },
        }),
      );
      expect(result.enrollments[0]).not.toHaveProperty('patientId');
    });

    it('applies cursor pagination', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      mockEnrollmentQb.getMany.mockResolvedValue([]);

      await service.getEnrollments(PROGRAM_ID, ORG_ID, { cursor: ENROLLMENT_ID, limit: 20 });

      expect(mockEnrollmentQb.andWhere).toHaveBeenCalledWith('e.id > :cursor', {
        cursor: ENROLLMENT_ID,
      });
    });

    it('returns nextCursor when more rows exist', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());

      const enrollments = Array.from({ length: 21 }, (_, i) => {
        const e = new Enrollment();
        e.id = `ENR${i.toString().padStart(23, '0')}`;
        e.sharedDataSnapshot = {};
        e.createdAt = new Date();
        e.status = 'active' as any;
        return e;
      });
      mockEnrollmentQb.getMany.mockResolvedValue(enrollments);

      const result = await service.getEnrollments(PROGRAM_ID, ORG_ID, { limit: 20 });

      expect(result.enrollments).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });

    it('throws ForbiddenException when program belongs to different org', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());

      await expect(
        service.getEnrollments(PROGRAM_ID, 'OTHER_ORG_ZZZZZZZZZZZ', { limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // triggerFanOut
  // ---------------------------------------------------------------------------

  describe('triggerFanOut', () => {
    it('enqueues fan_out_notify job for an approved non-expired program', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram({ status: ProgramStatus.APPROVED }));
      mockNotificationsQueue.add.mockResolvedValue(undefined);

      await service.triggerFanOut(PROGRAM_ID, ORG_ID);

      expect(mockNotificationsQueue.add).toHaveBeenCalledWith(
        'fan_out_notify',
        { programId: PROGRAM_ID, orgId: ORG_ID },
      );
    });

    it('throws ConflictException when program is pending review', async () => {
      mockProgramRepo.findOne.mockResolvedValue(
        makeProgram({ status: ProgramStatus.PENDING_REVIEW }),
      );

      await expect(service.triggerFanOut(PROGRAM_ID, ORG_ID)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when program is expired', async () => {
      mockProgramRepo.findOne.mockResolvedValue(
        makeProgram({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(service.triggerFanOut(PROGRAM_ID, ORG_ID)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when program not found', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);

      await expect(service.triggerFanOut(PROGRAM_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('updates program status and returns saved program', async () => {
      const program = makeProgram();
      const updated = makeProgram({ status: ProgramStatus.APPROVED });
      mockProgramRepo.findOne.mockResolvedValue(program);
      mockProgramRepo.save.mockResolvedValue(updated);
      mockMatchingService.indexProgram.mockResolvedValue(undefined);

      const result = await service.updateStatus(PROGRAM_ID, ProgramStatus.APPROVED);

      expect(mockProgramRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ProgramStatus.APPROVED }),
      );
      expect(result).toBe(updated);
    });

    it('calls indexProgram when status transitions to APPROVED', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      mockProgramRepo.save.mockResolvedValue(makeProgram({ status: ProgramStatus.APPROVED }));
      mockMatchingService.indexProgram.mockResolvedValue(undefined);

      await service.updateStatus(PROGRAM_ID, ProgramStatus.APPROVED);

      expect(mockMatchingService.indexProgram).toHaveBeenCalledWith(PROGRAM_ID);
    });

    it('does not call indexProgram when status is REJECTED', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      mockProgramRepo.save.mockResolvedValue(makeProgram({ status: ProgramStatus.REJECTED }));

      await service.updateStatus(PROGRAM_ID, ProgramStatus.REJECTED);

      expect(mockMatchingService.indexProgram).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when program not found', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);

      await expect(service.updateStatus(PROGRAM_ID, ProgramStatus.APPROVED)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
