import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';

import {
  AuditAction,
  EnrollmentStatus,
  OrgStatus,
  OrgType,
  ProgramStatus,
  ProgramType,
} from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ADMIN_QUEUE, MAIL_QUEUE, NOTIFICATIONS_QUEUE } from 'src/queues/queues.constants';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Enrollment } from 'src/modules/enrollments/entities/enrollment.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { MatchingService } from 'src/modules/matching/matching.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';

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

// select/addSelect/setParameters/innerJoin/getRawOne are here for getOrgStats, which
// aggregates in SQL rather than fetching rows.
const mockProgramQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getRawOne: jest.fn(),
  // findAllForAdmin joins the organisation and reads raw rows.
  leftJoin: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
};

const mockEnrollmentQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getRawOne: jest.fn(),
  getRawMany: jest.fn(),
};

const mockProgramRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(() => mockProgramQb),
};

const mockOrgRepo = {
  findOne: jest.fn(),
};

const mockEnrollmentRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(() => mockEnrollmentQb),
  // The per-state top condition needs jsonb_array_elements_text, which the builder
  // cannot express — that one aggregate is a parameterised raw query.
  query: jest.fn(),
};

const mockMatchingService = {
  getProgramMatchPreview: jest.fn(),
  indexProgram: jest.fn(),
};

const mockAdminQueue = { add: jest.fn() };
const mockNotificationsQueue = { add: jest.fn() };
const mockMailQueue = { add: jest.fn() };

// reviewEnrollment resolves the applicant's email for the outcome notice.
const mockPatientRepo = { findOne: jest.fn() };
const mockUserRepo = { findOne: jest.fn() };
const mockAuditService = { log: jest.fn() };
// The outcome reaches the patient in-app as well as by email.
const mockNotificationsService = { createOne: jest.fn() };

// The review moves the decision and the slot counter together.
const mockTxProgramQb = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 1 }),
};
const mockTxEnrollmentUpdate = jest.fn().mockResolvedValue({ affected: 1 });
const mockDataSource = {
  transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
    cb({
      getRepository: (entity: { name: string }) =>
        entity.name === 'Program'
          ? { createQueryBuilder: () => mockTxProgramQb }
          : { update: mockTxEnrollmentUpdate },
    }),
  ),
};

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
        { provide: getQueueToken(MAIL_QUEUE), useValue: mockMailQueue },
        { provide: getRepositoryToken(Patient), useValue: mockPatientRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: DataSource, useValue: mockDataSource },
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
    mockProgramQb.select.mockReturnThis();
    mockProgramQb.addSelect.mockReturnThis();
    mockProgramQb.setParameters.mockReturnThis();
    mockEnrollmentQb.select.mockReturnThis();
    mockEnrollmentQb.addSelect.mockReturnThis();
    mockEnrollmentQb.innerJoin.mockReturnThis();
    mockEnrollmentQb.leftJoin.mockReturnThis();
    mockEnrollmentQb.groupBy.mockReturnThis();
    mockEnrollmentQb.setParameters.mockReturnThis();
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

    it('creates the programme as a DRAFT, not a submission', async () => {
      const org = makeOrg();
      const program = makeProgram({ status: ProgramStatus.DRAFT });
      mockOrgRepo.findOne.mockResolvedValue(org);
      mockProgramRepo.create.mockReturnValue(program);
      mockProgramRepo.save.mockResolvedValue(program);

      const result = await service.create(ORG_ID, dto);

      expect(mockProgramRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: ORG_ID, status: ProgramStatus.DRAFT }),
      );
      expect(mockProgramRepo.save).toHaveBeenCalledWith(program);
      expect(result.status).toBe(ProgramStatus.DRAFT);
    });

    // Creating is no longer submitting: the NGO edits the draft first, and
    // submitForReview is what hands it to the platform.
    it('does not alert the admins on creation', async () => {
      const org = makeOrg();
      const program = makeProgram();
      mockOrgRepo.findOne.mockResolvedValue(org);
      mockProgramRepo.create.mockReturnValue(program);
      mockProgramRepo.save.mockResolvedValue(program);
      mockAdminQueue.add.mockResolvedValue(undefined);

      await service.create(ORG_ID, dto);

      expect(mockAdminQueue.add).not.toHaveBeenCalled();
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

      await expect(service.create(ORG_ID, { ...dto, expiresAt: PAST_DATE })).rejects.toThrow(
        UnprocessableEntityException,
      );
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

    // Newest first, and ULIDs sort by creation time — so paging forward walks the
    // ids downward and the keyset comparison runs the opposite way to an ascending
    // list. Getting this backwards returns the first page forever.
    it('orders newest first', async () => {
      mockProgramQb.getMany.mockResolvedValue([]);

      await service.findByOrg(ORG_ID, {} as ListProgramsDto);

      expect(mockProgramQb.orderBy).toHaveBeenCalledWith('p.id', 'DESC');
    });

    it('applies cursor filter when provided', async () => {
      mockProgramQb.getMany.mockResolvedValue([]);

      await service.findByOrg(ORG_ID, { cursor: PROGRAM_ID } as ListProgramsDto);

      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.id < :cursor', {
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

      await expect(service.findByIdForOrg(PROGRAM_ID, 'DIFFERENT_ORG_ZZZZZZZZZ')).rejects.toThrow(
        ForbiddenException,
      );
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

      await expect(service.getMatchPreview(PROGRAM_ID, 'OTHER_ORG_ZZZZZZZZZZZZ')).rejects.toThrow(
        ForbiddenException,
      );
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

      expect(mockNotificationsQueue.add).toHaveBeenCalledWith('fan_out_notify', {
        programId: PROGRAM_ID,
        orgId: ORG_ID,
      });
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
  // The two status axes must stay separate: `status` is the platform review state,
  // `lifecycle` is the operational one. A programme can be approved AND full.
  describe('derived lifecycle', () => {
    const DAY = 86_400_000;

    async function lifecycleFor(overrides: Partial<Program>): Promise<string> {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram(overrides));
      const view = await service.getForOrg(PROGRAM_ID, ORG_ID);
      return view.lifecycle;
    }

    // One label per review state. All three used to collapse into 'Draft', which
    // left an NGO unable to tell "waiting on the platform" from "rejected".
    it('reads Draft before it has been submitted', async () => {
      expect(await lifecycleFor({ status: ProgramStatus.DRAFT })).toBe('Draft');
    });

    it('reads In review once submitted', async () => {
      expect(await lifecycleFor({ status: ProgramStatus.PENDING_REVIEW })).toBe('In review');
    });

    it('reads Not approved after a rejection', async () => {
      expect(await lifecycleFor({ status: ProgramStatus.REJECTED })).toBe('Not approved');
    });

    it('reads Active when approved with room and time left', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() + 60 * DAY),
          slotsTotal: 50,
          slotsFilled: 10,
        }),
      ).toBe('Active');
    });

    it('reads Closing inside the final fortnight', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() + 3 * DAY),
          slotsTotal: 50,
          slotsFilled: 10,
        }),
      ).toBe('Closing');
    });

    it('reads Full once every place is taken', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() + 60 * DAY),
          slotsTotal: 20,
          slotsFilled: 20,
        }),
      ).toBe('Full');
    });

    // Pausing is deliberate; being full is a consequence. The deliberate act wins.
    it('reads Paused even when also full', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() + 60 * DAY),
          slotsTotal: 20,
          slotsFilled: 20,
          pausedAt: new Date(),
        }),
      ).toBe('Paused');
    });

    it('reads Expired once past its date, whatever else is true', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() - DAY),
          pausedAt: new Date(),
        }),
      ).toBe('Expired');
    });

    it('treats an uncapped programme as never full', async () => {
      expect(
        await lifecycleFor({
          status: ProgramStatus.APPROVED,
          expiresAt: new Date(Date.now() + 60 * DAY),
          slotsTotal: undefined,
          slotsFilled: 0,
        }),
      ).toBe('Active');
    });

    it('never reports negative places remaining', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram({ slotsTotal: 5, slotsFilled: 9 }));
      const view = await service.getForOrg(PROGRAM_ID, ORG_ID);
      expect(view.slotsAvailable).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // submitForReview — the step that used to be implicit in create()
  // ---------------------------------------------------------------------------
  describe('submitForReview', () => {
    const ACTOR = '01HZZZZZZZZZZZZZZZZZZZUSR';

    function pending(overrides: Partial<Program> = {}) {
      const program = makeProgram({ status: ProgramStatus.DRAFT, ...overrides });
      mockProgramRepo.findOne.mockResolvedValue(program);
      mockProgramRepo.update.mockResolvedValue({ affected: 1 });
      return program;
    }

    it('hands a draft to the platform and alerts the admins', async () => {
      pending();

      const view = await service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR);

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch.status).toBe(ProgramStatus.PENDING_REVIEW);
      expect(mockAdminQueue.add).toHaveBeenCalledWith(
        'program_review',
        expect.objectContaining({ programId: PROGRAM_ID, orgId: ORG_ID }),
      );
      expect(view).toBeDefined();
    });

    // Rejection was terminal: nothing could move it back to a reviewable state.
    it('resubmits a rejected programme and clears the stale reason', async () => {
      pending({ status: ProgramStatus.REJECTED, rejectionReason: 'Eligibility too broad' });

      await service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR);

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch).toEqual(
        expect.objectContaining({
          status: ProgramStatus.PENDING_REVIEW,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
        }),
      );
    });

    it('audits the submission', async () => {
      pending();

      await service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR,
          action: AuditAction.APPLICATION_SUBMITTED,
          resourceType: 'program',
        }),
      );
    });

    it.each([[ProgramStatus.PENDING_REVIEW], [ProgramStatus.APPROVED], [ProgramStatus.EXPIRED]])(
      '409s when the programme is already %s',
      async (status) => {
        pending({ status });

        await expect(service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockProgramRepo.update).not.toHaveBeenCalled();
      },
    );

    it('refuses to submit something already past its closing date', async () => {
      pending({ expiresAt: new Date(Date.now() - 86_400_000) });

      await expect(service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('403s on another organisation’s programme', async () => {
      pending({ orgId: 'OTHERORG' });

      await expect(service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockProgramRepo.update).not.toHaveBeenCalled();
    });

    // The submission has committed; a queue outage must not report failure for it,
    // or the NGO retries into a 409.
    it('still succeeds when the admin alert cannot be queued', async () => {
      pending();
      mockAdminQueue.add.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.submitForReview(PROGRAM_ID, ORG_ID, ACTOR)).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // findAllForAdmin — the review queue
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // browseForPatient — what a patient sees before applying
  // ---------------------------------------------------------------------------
  describe('browseForPatient', () => {
    function rawRow(over: Record<string, unknown> = {}) {
      return {
        id: PROGRAM_ID,
        title: 'Chronic Care Fund',
        type: ProgramType.NGO_FUNDING,
        orgId: ORG_ID,
        orgName: 'Hope Health',
        expiresAt: new Date(),
        slotsTotal: 50,
        slotsFilled: 12,
        description: 'Covers monthly medication costs.',
        focus: 'Diabetes · Hypertension',
        donor: 'GSK Nigeria',
        coordinator: 'Bisi Lawal',
        ...over,
      };
    }

    beforeEach(() => {
      mockProgramQb.getRawMany.mockResolvedValue([rawRow()]);
    });

    it('returns what the NGO wrote about the programme', async () => {
      const { programs } = await service.browseForPatient({ limit: 20 } as PaginationDto);

      expect(programs[0]).toEqual(
        expect.objectContaining({
          description: 'Covers monthly medication costs.',
          focus: 'Diabetes · Hypertension',
          donor: 'GSK Nigeria',
          coordinator: 'Bisi Lawal',
        }),
      );
    });

    // orgId is an opaque ULID and no patient-reachable endpoint resolves it, so
    // without the join a patient cannot tell who is offering the programme.
    it('names the organisation', async () => {
      const { programs } = await service.browseForPatient({ limit: 20 } as PaginationDto);

      expect(mockProgramQb.leftJoin).toHaveBeenCalled();
      expect(programs[0].orgName).toBe('Hope Health');
    });

    /**
     * The privacy assertion. Budget reads as a promise of a personal award,
     * eligibility criteria are matcher config, and the review trail is the NGO's
     * private correspondence with the platform.
     */
    it('withholds budget, eligibility and the review trail', async () => {
      await service.browseForPatient({ limit: 20 } as PaginationDto);

      const selected = mockProgramQb.select.mock.calls.flat(2).join(' ');
      for (const column of [
        'budget_total',
        'budget_disbursed',
        'eligibility_criteria',
        'p.status',
        'rejection_reason',
        'reviewed_by',
      ]) {
        expect(selected).not.toContain(column);
      }
    });

    it('shows only approved, unpaused, unexpired programmes', async () => {
      await service.browseForPatient({ limit: 20 } as PaginationDto);

      expect(mockProgramQb.where).toHaveBeenCalledWith('p.status = :status', {
        status: ProgramStatus.APPROVED,
      });
      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.expires_at > NOW()');
      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.paused_at IS NULL');
    });

    it('pages forward from the cursor', async () => {
      mockProgramQb.getRawMany.mockResolvedValue([
        rawRow({ id: 'P1' }),
        rawRow({ id: 'P2' }),
        rawRow({ id: 'P3' }),
      ]);

      const { programs, nextCursor } = await service.browseForPatient({
        limit: 2,
      } as PaginationDto);

      expect(programs).toHaveLength(2);
      expect(nextCursor).toBe('P2');
    });

    // Every detail column is nullable, and programmes created before they existed
    // have none of them.
    it('handles a programme with no detail at all', async () => {
      mockProgramQb.getRawMany.mockResolvedValue([
        rawRow({ description: null, focus: null, donor: null, coordinator: null }),
      ]);

      const { programs } = await service.browseForPatient({ limit: 20 } as PaginationDto);

      expect(programs[0].title).toBe('Chronic Care Fund');
      expect(programs[0].description).toBeNull();
    });
  });

  describe('findAllForAdmin', () => {
    function rawRow(over: Record<string, unknown> = {}) {
      return {
        id: PROGRAM_ID,
        title: 'Chronic Care Fund',
        status: ProgramStatus.PENDING_REVIEW,
        orgId: ORG_ID,
        orgName: 'Hope Health',
        budgetTotal: '1850000000',
        ...over,
      };
    }

    beforeEach(() => {
      mockProgramQb.leftJoin.mockReturnThis();
      mockProgramQb.limit.mockReturnThis();
      mockProgramQb.getRawMany.mockResolvedValue([rawRow()]);
    });

    // A draft is the NGO's private working copy — it has been handed to nobody.
    it('never exposes drafts to the review queue', async () => {
      await service.findAllForAdmin({ limit: 20 } as ListProgramsDto);

      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.status <> :draft', {
        draft: ProgramStatus.DRAFT,
      });
    });

    it('returns the submitting organisation alongside the programme', async () => {
      const { programs } = await service.findAllForAdmin({ limit: 20 } as ListProgramsDto);

      expect(programs[0].orgName).toBe('Hope Health');
    });

    // bigint comes back from pg as a string outside the entity transformer.
    it('returns the budget as a number, not a string', async () => {
      const { programs } = await service.findAllForAdmin({ limit: 20 } as ListProgramsDto);

      expect(programs[0].budgetTotal).toBe(1_850_000_000);
    });

    it('pages backwards from the cursor, newest first', async () => {
      mockProgramQb.getRawMany.mockResolvedValue([
        rawRow({ id: 'P3' }),
        rawRow({ id: 'P2' }),
        rawRow({ id: 'P1' }),
      ]);

      const { programs, nextCursor } = await service.findAllForAdmin({
        limit: 2,
      } as ListProgramsDto);

      expect(mockProgramQb.orderBy).toHaveBeenCalledWith('p.id', 'DESC');
      expect(programs).toHaveLength(2);
      expect(nextCursor).toBe('P2');
    });

    it('filters by status when asked', async () => {
      await service.findAllForAdmin({
        limit: 20,
        status: ProgramStatus.PENDING_REVIEW,
      } as ListProgramsDto);

      expect(mockProgramQb.andWhere).toHaveBeenCalledWith('p.status = :status', {
        status: ProgramStatus.PENDING_REVIEW,
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockProgramRepo.update.mockResolvedValue({ affected: 1 });
    });

    // Defaults to DRAFT — the state where everything is editable. Approved
    // programmes are locked, which the block at the end of this describe covers.
    function existing(overrides: Partial<Program> = {}) {
      const program = makeProgram({ status: ProgramStatus.DRAFT, ...overrides });
      mockProgramRepo.findOne.mockResolvedValue(program);
      return program;
    }

    it('applies only the fields supplied', async () => {
      existing();
      await service.update(PROGRAM_ID, ORG_ID, { title: 'Renamed' });

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch).toEqual({ title: 'Renamed' });
    });

    it('pausing stamps pausedAt', async () => {
      existing({ status: ProgramStatus.APPROVED });
      await service.update(PROGRAM_ID, ORG_ID, { paused: true });

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch.pausedAt).toEqual(expect.any(Date));
    });

    // undefined would mean "leave unchanged" to TypeORM, making Resume a no-op.
    it('resuming writes an explicit null, not undefined', async () => {
      existing({ status: ProgramStatus.APPROVED, pausedAt: new Date() });
      await service.update(PROGRAM_ID, ORG_ID, { paused: false });

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch.pausedAt).toBeNull();
    });

    it('refuses to cut capacity below places already filled', async () => {
      existing({ slotsTotal: 50, slotsFilled: 30 });

      await expect(service.update(PROGRAM_ID, ORG_ID, { slotsTotal: 10 })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(mockProgramRepo.update).not.toHaveBeenCalled();
    });

    it('allows cutting capacity down to exactly what is filled', async () => {
      existing({ slotsTotal: 50, slotsFilled: 30 });
      await expect(service.update(PROGRAM_ID, ORG_ID, { slotsTotal: 30 })).resolves.toBeDefined();
    });

    it('refuses to cut the budget below what is already disbursed', async () => {
      existing({ budgetTotal: 1_000_000, budgetDisbursed: 400_000 });

      await expect(
        service.update(PROGRAM_ID, ORG_ID, { budgetTotal: 100_000 }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('refuses an expiry in the past', async () => {
      existing();
      await expect(
        service.update(PROGRAM_ID, ORG_ID, { expiresAt: PAST_DATE }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("403s on another organisation's programme, before writing anything", async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram({ orgId: 'OTHERORG' }));

      await expect(
        service.update(PROGRAM_ID, ORG_ID, { title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockProgramRepo.update).not.toHaveBeenCalled();
    });

    it('404s on a programme that does not exist', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);

      await expect(service.update(PROGRAM_ID, ORG_ID, { title: 'Ghost' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('skips the write entirely for an empty patch', async () => {
      existing();
      await service.update(PROGRAM_ID, ORG_ID, {});
      expect(mockProgramRepo.update).not.toHaveBeenCalled();
    });

    // Edits used to leave no trace at all, so a live programme could be re-scoped
    // with nothing to show for it.
    it('audits what changed', async () => {
      existing();
      await service.update(PROGRAM_ID, ORG_ID, { title: 'Renamed' }, 'user-1');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: AuditAction.PROGRAM_UPDATED,
          resourceId: PROGRAM_ID,
          resourceType: 'program',
        }),
      );
    });

    it('still succeeds when the audit write fails', async () => {
      existing();
      mockAuditService.log.mockRejectedValueOnce(new Error('db down'));

      await expect(service.update(PROGRAM_ID, ORG_ID, { title: 'Renamed' })).resolves.toBeDefined();
    });

    it('lets a draft change who qualifies', async () => {
      existing();
      const criteria = [{ field: 'conditionTags', operator: 'in' as const, value: ['Asthma'] }];

      await service.update(PROGRAM_ID, ORG_ID, { eligibilityCriteria: criteria });

      const [, patch] = mockProgramRepo.update.mock.calls[0];
      expect(patch.eligibilityCriteria).toEqual(criteria);
    });

    // Patients have applied under the approved terms, so the programme is frozen
    // apart from pausing intake and pushing the closing date out.
    describe('once approved', () => {
      const approved = () => existing({ status: ProgramStatus.APPROVED });

      it.each([
        ['title', { title: 'Renamed' }],
        ['budgetTotal', { budgetTotal: 5_000_000 }],
        ['slotsTotal', { slotsTotal: 99 }],
        ['description', { description: 'Rewritten' }],
        [
          'eligibilityCriteria',
          { eligibilityCriteria: [{ field: 'gender', operator: 'eq' as const, value: 'female' }] },
        ],
      ])('refuses to change %s', async (_field, dto) => {
        approved();

        await expect(service.update(PROGRAM_ID, ORG_ID, dto)).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
        expect(mockProgramRepo.update).not.toHaveBeenCalled();
      });

      it('allows pausing and resuming', async () => {
        approved();
        await expect(service.update(PROGRAM_ID, ORG_ID, { paused: true })).resolves.toBeDefined();
      });

      it('allows extending the closing date', async () => {
        const program = approved();
        const later = new Date(program.expiresAt.getTime() + 30 * 86_400_000).toISOString();

        await expect(
          service.update(PROGRAM_ID, ORG_ID, { expiresAt: later }),
        ).resolves.toBeDefined();
      });

      // Closing early is what Pause is for; shortening the window under people who
      // already applied is not something to do quietly.
      it('refuses to bring the closing date forward', async () => {
        const program = approved();
        const sooner = new Date(program.expiresAt.getTime() - 3_600_000).toISOString();

        await expect(
          service.update(PROGRAM_ID, ORG_ID, { expiresAt: sooner }),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
      });
    });

    it('refuses to edit an expired programme at all', async () => {
      existing({ status: ProgramStatus.EXPIRED });

      await expect(service.update(PROGRAM_ID, ORG_ID, { title: 'Renamed' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
  // Slot accounting is the substantive part: SELECTED occupies a place, everything
  // else releases it, and both move with the decision in one transaction.
  describe('reviewEnrollment', () => {
    const ENR_ID = ENROLLMENT_ID;
    const REVIEWER = '01HZZZZZZZZZZZZZZZZZZZREV';

    function setup(
      programOverrides: Partial<Program> = {},
      enrollmentStatus = EnrollmentStatus.ACTIVE,
    ) {
      mockProgramRepo.findOne.mockResolvedValue(
        makeProgram({
          status: ProgramStatus.APPROVED,
          slotsTotal: 50,
          slotsFilled: 10,
          ...programOverrides,
        }),
      );
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: ENR_ID,
        programId: PROGRAM_ID,
        patientId: '01HZZZZZZZZZZZZZZZZZZZZPAT',
        status: enrollmentStatus,
        sharedDataSnapshot: { name: 'Ada' },
        createdAt: new Date(),
      });
      mockPatientRepo.findOne.mockResolvedValue(null); // skips the email lookup
    }

    /** The relative SQL the slot counter is moved with, if it moved at all. */
    function slotSql(): string | undefined {
      if (!mockTxProgramQb.set.mock.calls.length) return undefined;
      const setter = mockTxProgramQb.set.mock.calls[0][0].slotsFilled;
      return typeof setter === 'function' ? setter() : String(setter);
    }

    it('records the decision and stamps the reviewer', async () => {
      setup();
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.SELECTED,
      });

      const [, patch] = mockTxEnrollmentUpdate.mock.calls[0];
      expect(patch.status).toBe(EnrollmentStatus.SELECTED);
      expect(patch.reviewedBy).toBe(REVIEWER);
      expect(patch.reviewedAt).toEqual(expect.any(Date));
    });

    it('selecting takes a place', async () => {
      setup();
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.SELECTED,
      });
      expect(slotSql()).toContain('+ 1');
    });

    it('un-selecting gives the place back', async () => {
      setup({}, EnrollmentStatus.SELECTED);
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.REJECTED,
        reason: 'No longer eligible',
      });
      expect(slotSql()).toContain('- 1');
    });

    it('waitlisting an applicant who never held a place moves no counter', async () => {
      setup();
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.WAITLISTED,
      });
      expect(slotSql()).toBeUndefined();
    });

    // A relative update, so two reviewers acting at once cannot clobber each other.
    it('moves the counter relatively, never to a computed absolute', async () => {
      setup();
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.SELECTED,
      });
      expect(slotSql()).toContain('slots_filled');
      expect(slotSql()).toContain('GREATEST(0');
    });

    it('refuses to select into a full programme', async () => {
      setup({ slotsTotal: 20, slotsFilled: 20 });

      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.SELECTED,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockTxEnrollmentUpdate).not.toHaveBeenCalled();
    });

    it('still allows rejecting when the programme is full', async () => {
      setup({ slotsTotal: 20, slotsFilled: 20 });
      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.REJECTED,
          reason: 'Out of scope',
        }),
      ).resolves.toBeDefined();
    });

    it('clears a stale reason when a rejection is reversed', async () => {
      setup({}, EnrollmentStatus.REJECTED);
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.SELECTED,
      });

      const [, patch] = mockTxEnrollmentUpdate.mock.calls[0];
      expect(patch.rejectionReason).toBeNull();
    });

    it('audits the decision', async () => {
      setup();
      await service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
        status: EnrollmentStatus.REJECTED,
        reason: 'Income above threshold',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: REVIEWER,
          resourceId: ENR_ID,
          resourceType: 'enrollment',
        }),
      );
    });

    // These two outcomes belong to the patient and the system.
    it.each([[EnrollmentStatus.REVOKED_BY_PATIENT], [EnrollmentStatus.EXPIRED]])(
      'refuses to review an enrollment that is %s',
      async (status) => {
        setup({}, status);
        await expect(
          service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
            status: EnrollmentStatus.SELECTED,
          }),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('refuses a no-op re-decision', async () => {
      setup({}, EnrollmentStatus.SELECTED);
      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.SELECTED,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s when the enrollment belongs to a different programme', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram({ status: ProgramStatus.APPROVED }));
      mockEnrollmentRepo.findOne.mockResolvedValue({ id: ENR_ID, programId: 'OTHERPROGRAM' });

      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.SELECTED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("403s on another organisation's programme, before writing anything", async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram({ orgId: 'OTHERORG' }));

      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.SELECTED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockTxEnrollmentUpdate).not.toHaveBeenCalled();
    });

    // The decision has committed; a queue outage must not report failure for it,
    // or the reviewer retries into a 409 "already selected".
    it('still succeeds when the applicant email cannot be queued', async () => {
      setup();
      mockPatientRepo.findOne.mockRejectedValue(new Error('db down'));

      await expect(
        service.reviewEnrollment(PROGRAM_ID, ENR_ID, ORG_ID, REVIEWER, {
          status: EnrollmentStatus.SELECTED,
        }),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getOrgStats
  // ---------------------------------------------------------------------------
  describe('getOrgStats', () => {
    function setupRaw(
      program: Record<string, string> = {},
      enrollment: Record<string, string> = {},
    ) {
      mockProgramQb.getRawOne.mockResolvedValue({
        totalPrograms: '4',
        activePrograms: '2',
        budgetTotal: '1850000000',
        budgetDisbursed: '1120000000',
        slotsTotal: '90',
        slotsFilled: '52',
        ...program,
      });
      mockEnrollmentQb.getRawOne.mockResolvedValue({
        totalApplicants: '31',
        pendingReview: '7',
        selectedPatients: '18',
        waitlisted: '4',
        rejected: '2',
        ...enrollment,
      });
    }

    it('returns numbers, not the strings Postgres sends for COUNT and SUM', async () => {
      setupRaw();

      const stats = await service.getOrgStats(ORG_ID);

      expect(stats).toEqual({
        activePrograms: 2,
        totalPrograms: 4,
        totalApplicants: 31,
        pendingReview: 7,
        selectedPatients: 18,
        waitlisted: 4,
        rejected: 2,
        budgetTotal: 1_850_000_000,
        budgetDisbursed: 1_120_000_000,
        slotsTotal: 90,
        slotsFilled: 52,
      });
    });

    it('scopes both aggregates to the organisation', async () => {
      setupRaw();

      await service.getOrgStats(ORG_ID);

      expect(mockProgramQb.where).toHaveBeenCalledWith('p.org_id = :orgId', { orgId: ORG_ID });
      // Enrollments are reached through the org's own programmes, never the patients table.
      expect(mockEnrollmentQb.innerJoin).toHaveBeenCalled();
      expect(mockEnrollmentQb.where).toHaveBeenCalledWith('p.org_id = :orgId', { orgId: ORG_ID });
    });

    // A brand-new NGO must read as zeros, not NaN on the dashboard.
    it('reads as zeros for an organisation with nothing yet', async () => {
      mockProgramQb.getRawOne.mockResolvedValue(undefined);
      mockEnrollmentQb.getRawOne.mockResolvedValue(undefined);

      const stats = await service.getOrgStats(ORG_ID);

      expect(Object.values(stats).every((v) => v === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getPatientMap
  // ---------------------------------------------------------------------------
  describe('getPatientMap', () => {
    beforeEach(() => {
      mockEnrollmentQb.getRawMany.mockResolvedValue([
        { state: 'Lagos', selected: '8', inReview: '3', waitlisted: '1', total: '12' },
        { state: 'Unspecified', selected: '1', inReview: '2', waitlisted: '0', total: '3' },
      ]);
      mockEnrollmentRepo.query.mockResolvedValue([{ state: 'Lagos', tag: 'Hypertension' }]);
    });

    it('returns per-state counts as numbers, with the top condition attached', async () => {
      const rows = await service.getPatientMap(ORG_ID);

      expect(rows[0]).toEqual({
        state: 'Lagos',
        selected: 8,
        inReview: 3,
        waitlisted: 1,
        total: 12,
        topCondition: 'Hypertension',
      });
    });

    // Patients who onboarded before the location columns existed must still be counted.
    it('keeps unlocated applicants in an Unspecified row rather than dropping them', async () => {
      const rows = await service.getPatientMap(ORG_ID);

      const unspecified = rows.find((r) => r.state === 'Unspecified');
      expect(unspecified?.total).toBe(3);
      expect(unspecified?.topCondition).toBeUndefined();
    });

    it('scopes to the organisation and never selects a patient row', async () => {
      await service.getPatientMap(ORG_ID);

      expect(mockEnrollmentQb.where).toHaveBeenCalledWith('p.org_id = :orgId', { orgId: ORG_ID });
      const selected = mockEnrollmentQb.select.mock.calls.flat().join(' ');
      expect(selected).toContain('location_state');
      expect(selected).not.toContain('pat.id');
      expect(selected).not.toContain('patient_id');
    });
  });
});
