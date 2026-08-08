import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';

import {
  ApplicantRole,
  ApplicationEmailEvent,
  AuditAction,
  OrgStatus,
  OrgType,
  ProgramStatus,
  StudyStatus,
} from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { ProgramsService } from 'src/modules/programs/programs.service';
import { StudiesService } from 'src/modules/studies/studies.service';
import { MatchingService } from 'src/modules/matching/matching.service';
import {
  ADMIN_QUEUE,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  SEND_APPLICATION_STATUS_JOB,
  STUDY_APPROVED_JOB,
  STUDY_REJECTED_JOB,
} from 'src/queues/queues.constants';

import { AdminService } from './admin.service';
import { AdminApproveDto } from './dto/admin-approve.dto';

const ADMIN_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';

const mockOrg = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZAB',
  name: 'Test Org',
  type: OrgType.NGO,
  status: OrgStatus.PENDING_VERIFICATION,
  contactEmail: 'ops@testorg.example',
  createdBy: '01HZZZZZZZZZZZZZZZZZZZZZAC',
};

const mockProgram = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZAD',
  title: 'Test Program',
  status: ProgramStatus.PENDING_REVIEW,
  // The outcome notice is addressed by org: createdBy is null for anything created
  // outside a CLS-bearing request, which left the old payload with no recipient.
  orgId: '01HZZZZZZZZZZZZZZZZZZZZORG',
  createdBy: '01HZZZZZZZZZZZZZZZZZZZZZAE',
};

const mockStudy = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZAF',
  title: 'Test Study',
  status: StudyStatus.PENDING_REVIEW,
  researcherId: '01HZZZZZZZZZZZZZZZZZZZZZAG',
};

const STAFF_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAH';
const STAFF_USER_EMAIL = 'staff@testorg.example';

// reviewOrganization writes the org status and activates the staff user inside a
// single transaction, then resolves the staff user for the queue payload.
const mockOrgUpdate = jest.fn();
const mockUserUpdate = jest.fn();
const mockStaffFindOne = jest.fn();

const mockTxManager = {
  getRepository: jest.fn((entity: unknown) =>
    entity === Organization ? { update: mockOrgUpdate } : { update: mockUserUpdate },
  ),
};

const mockDataSource = {
  transaction: jest.fn((cb: (m: typeof mockTxManager) => Promise<unknown>) => cb(mockTxManager)),
  getRepository: jest.fn(() => ({ findOne: mockStaffFindOne })),
};

describe('AdminService', () => {
  let service: AdminService;
  let orgsService: jest.Mocked<Pick<OrganizationsService, 'findOne' | 'updateStatus'>>;
  let programsService: jest.Mocked<Pick<ProgramsService, 'findOne' | 'updateStatus'>>;
  let studiesService: jest.Mocked<Pick<StudiesService, 'findOne' | 'updateStatus'>>;
  let matchingService: jest.Mocked<Pick<MatchingService, 'indexProgram' | 'indexStudy'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;
  let adminQueue: { add: jest.Mock };
  let mailQueue: { add: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: OrganizationsService,
          useValue: { findOne: jest.fn(), updateStatus: jest.fn() },
        },
        {
          provide: ProgramsService,
          useValue: { findOne: jest.fn(), updateStatus: jest.fn() },
        },
        {
          provide: StudiesService,
          useValue: { findOne: jest.fn(), updateStatus: jest.fn() },
        },
        {
          provide: MatchingService,
          useValue: { indexProgram: jest.fn(), indexStudy: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn() },
        },
        {
          provide: getQueueToken(ADMIN_QUEUE),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken(MAIL_QUEUE),
          useValue: { add: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    mockOrgUpdate.mockReset().mockResolvedValue(undefined);
    mockUserUpdate.mockReset().mockResolvedValue(undefined);
    mockStaffFindOne.mockReset().mockResolvedValue({ id: STAFF_USER_ID, email: STAFF_USER_EMAIL });

    service = module.get(AdminService);
    orgsService = module.get(OrganizationsService);
    programsService = module.get(ProgramsService);
    studiesService = module.get(StudiesService);
    matchingService = module.get(MatchingService);
    auditService = module.get(AuditService);
    adminQueue = module.get(getQueueToken(ADMIN_QUEUE));
    mailQueue = module.get(getQueueToken(MAIL_QUEUE));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // reviewOrganization
  // ---------------------------------------------------------------------------

  describe('reviewOrganization', () => {
    it('propagates NotFoundException when org does not exist', async () => {
      orgsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when org is not in PENDING_VERIFICATION state', async () => {
      orgsService.findOne.mockResolvedValue({ ...mockOrg, status: OrgStatus.ACTIVE } as any);

      await expect(
        service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves org: sets ACTIVE, activates the staff user, audits, emails the approval', async () => {
      orgsService.findOne.mockResolvedValue(mockOrg as any);
      auditService.log.mockResolvedValue(undefined);
      mailQueue.add.mockResolvedValue(undefined);

      const dto: AdminApproveDto = { status: 'approved' };
      await service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, dto);

      expect(mockOrgUpdate).toHaveBeenCalledWith(
        { id: mockOrg.id },
        expect.objectContaining({ status: OrgStatus.ACTIVE, verifiedBy: ADMIN_USER_ID }),
      );
      // Parity with the professional/benefactor review path.
      expect(mockUserUpdate).toHaveBeenCalledWith({ orgId: mockOrg.id }, { status: 'active' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_APPROVE, resourceId: mockOrg.id }),
      );
      // Replaces the old ORG_VERIFIED_JOB, which had no handler and was discarded.
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPLICATION_STATUS_JOB,
        expect.objectContaining({
          applicantName: mockOrg.name,
          role: ApplicantRole.NGO,
          event: ApplicationEmailEvent.APPROVED,
        }),
        MAIL_JOB_OPTIONS,
      );
    });

    it('rejects org: sets REJECTED with reason, leaves the user pending, emails the reason', async () => {
      orgsService.findOne.mockResolvedValue(mockOrg as any);
      auditService.log.mockResolvedValue(undefined);
      mailQueue.add.mockResolvedValue(undefined);

      const dto: AdminApproveDto = { status: 'rejected', reason: 'Documents incomplete' };
      await service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, dto);

      expect(mockOrgUpdate).toHaveBeenCalledWith(
        { id: mockOrg.id },
        expect.objectContaining({
          status: OrgStatus.REJECTED,
          rejectionReason: 'Documents incomplete',
        }),
      );
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ADMIN_REJECT,
          resourceId: mockOrg.id,
          metadata: { reason: 'Documents incomplete' },
        }),
      );
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPLICATION_STATUS_JOB,
        expect.objectContaining({
          event: ApplicationEmailEvent.REJECTED,
          reason: 'Documents incomplete',
        }),
        MAIL_JOB_OPTIONS,
      );
    });

    // Both org types flow through this one method, so reading org.type matters.
    it('addresses an HMO as an HMO, not an NGO', async () => {
      orgsService.findOne.mockResolvedValue({ ...mockOrg, type: OrgType.HMO } as any);
      auditService.log.mockResolvedValue(undefined);
      mailQueue.add.mockResolvedValue(undefined);

      await service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' });

      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPLICATION_STATUS_JOB,
        expect.objectContaining({ role: ApplicantRole.HMO }),
        MAIL_JOB_OPTIONS,
      );
    });

    // The review has already committed; a queue outage must not report failure for it,
    // or the admin retries into a 409 "not in a reviewable state".
    it('still succeeds when the mail enqueue fails', async () => {
      orgsService.findOne.mockResolvedValue(mockOrg as any);
      auditService.log.mockResolvedValue(undefined);
      mailQueue.add.mockRejectedValue(new Error('redis unreachable'));

      await expect(
        service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' }),
      ).resolves.toBeDefined();

      expect(mockUserUpdate).toHaveBeenCalledWith({ orgId: mockOrg.id }, { status: 'active' });
    });

    // org.createdBy is null for orgs created during unauthenticated signup.
    it('emails the staff user resolved by orgId', async () => {
      orgsService.findOne.mockResolvedValue({ ...mockOrg, createdBy: undefined } as any);
      auditService.log.mockResolvedValue(undefined);
      mailQueue.add.mockResolvedValue(undefined);

      await service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' });

      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPLICATION_STATUS_JOB,
        expect.objectContaining({ to: STAFF_USER_EMAIL }),
        MAIL_JOB_OPTIONS,
      );
    });

    it('omits metadata when approving without a reason', async () => {
      orgsService.findOne.mockResolvedValue(mockOrg as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockResolvedValue(undefined);

      await service.reviewOrganization(mockOrg.id, ADMIN_USER_ID, { status: 'approved' });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: undefined }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // reviewProgram
  // ---------------------------------------------------------------------------

  describe('reviewProgram', () => {
    it('propagates NotFoundException when program does not exist', async () => {
      programsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.reviewProgram(mockProgram.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when program is not in PENDING_REVIEW state', async () => {
      programsService.findOne.mockResolvedValue({ ...mockProgram, status: ProgramStatus.APPROVED } as any);

      await expect(
        service.reviewProgram(mockProgram.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves program: records the reviewer, writes ADMIN_APPROVE audit, enqueues PROGRAM_APPROVED_JOB', async () => {
      programsService.findOne.mockResolvedValue(mockProgram as any);
      programsService.updateStatus.mockResolvedValue(undefined as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockResolvedValue(undefined);

      await service.reviewProgram(mockProgram.id, ADMIN_USER_ID, { status: 'approved' });

      // The decision is stored on the programme, not only in the audit row the NGO
      // cannot read. indexProgram now happens inside updateStatus — calling it here
      // as well indexed every approval twice.
      expect(programsService.updateStatus).toHaveBeenCalledWith(
        mockProgram.id,
        ProgramStatus.APPROVED,
        { reason: undefined, reviewedBy: ADMIN_USER_ID },
      );
      expect(matchingService.indexProgram).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_APPROVE, resourceId: mockProgram.id }),
      );
      expect(adminQueue.add).toHaveBeenCalledWith(
        PROGRAM_APPROVED_JOB,
        expect.objectContaining({
          programId: mockProgram.id,
          programTitle: mockProgram.title,
          // Recipients are resolved from the org: program.createdBy is null for
          // anything created without a CLS user, which left the notice unaddressed.
          orgId: mockProgram.orgId,
        }),
      );
    });

    it('rejects program: stores the reason and enqueues PROGRAM_REJECTED_JOB', async () => {
      programsService.findOne.mockResolvedValue(mockProgram as any);
      programsService.updateStatus.mockResolvedValue(undefined as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockResolvedValue(undefined);

      await service.reviewProgram(mockProgram.id, ADMIN_USER_ID, { status: 'rejected', reason: 'Not eligible' });

      expect(programsService.updateStatus).toHaveBeenCalledWith(
        mockProgram.id,
        ProgramStatus.REJECTED,
        { reason: 'Not eligible', reviewedBy: ADMIN_USER_ID },
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_REJECT }),
      );
      expect(adminQueue.add).toHaveBeenCalledWith(
        PROGRAM_REJECTED_JOB,
        expect.objectContaining({ programId: mockProgram.id, reason: 'Not eligible' }),
      );
      expect(adminQueue.add).not.toHaveBeenCalledWith(PROGRAM_APPROVED_JOB, expect.anything());
    });

    // The review has committed by then; a 500 would send the admin back to a 409.
    it('still succeeds when the outcome job cannot be enqueued', async () => {
      programsService.findOne.mockResolvedValue(mockProgram as any);
      programsService.updateStatus.mockResolvedValue(undefined as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockRejectedValue(new Error('redis down'));

      await expect(
        service.reviewProgram(mockProgram.id, ADMIN_USER_ID, { status: 'approved' }),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // reviewStudy
  // ---------------------------------------------------------------------------

  describe('reviewStudy', () => {
    it('propagates NotFoundException when study does not exist', async () => {
      studiesService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.reviewStudy(mockStudy.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when study is not in PENDING_REVIEW state', async () => {
      studiesService.findOne.mockResolvedValue({ ...mockStudy, status: StudyStatus.APPROVED } as any);

      await expect(
        service.reviewStudy(mockStudy.id, ADMIN_USER_ID, { status: 'approved' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves study: calls updateStatus(APPROVED), indexStudy, writes ADMIN_APPROVE audit, enqueues STUDY_APPROVED_JOB', async () => {
      studiesService.findOne.mockResolvedValue(mockStudy as any);
      studiesService.updateStatus.mockResolvedValue(undefined as any);
      matchingService.indexStudy.mockResolvedValue(undefined as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockResolvedValue(undefined);

      await service.reviewStudy(mockStudy.id, ADMIN_USER_ID, { status: 'approved' });

      expect(studiesService.updateStatus).toHaveBeenCalledWith(mockStudy.id, StudyStatus.APPROVED);
      expect(matchingService.indexStudy).toHaveBeenCalledWith(mockStudy.id);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_APPROVE, resourceId: mockStudy.id }),
      );
      expect(adminQueue.add).toHaveBeenCalledWith(
        STUDY_APPROVED_JOB,
        expect.objectContaining({
          studyId: mockStudy.id,
          researcherUserId: mockStudy.researcherId,
          studyTitle: mockStudy.title,
        }),
      );
    });

    it('rejects study: does NOT call indexStudy, writes ADMIN_REJECT audit, enqueues STUDY_REJECTED_JOB', async () => {
      studiesService.findOne.mockResolvedValue(mockStudy as any);
      studiesService.updateStatus.mockResolvedValue(undefined as any);
      auditService.log.mockResolvedValue(undefined);
      adminQueue.add.mockResolvedValue(undefined);

      await service.reviewStudy(mockStudy.id, ADMIN_USER_ID, { status: 'rejected', reason: 'IRB expired' });

      expect(studiesService.updateStatus).toHaveBeenCalledWith(mockStudy.id, StudyStatus.REJECTED);
      expect(matchingService.indexStudy).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_REJECT }),
      );
      expect(adminQueue.add).toHaveBeenCalledWith(
        STUDY_REJECTED_JOB,
        expect.objectContaining({ studyId: mockStudy.id, reason: 'IRB expired' }),
      );
      expect(adminQueue.add).not.toHaveBeenCalledWith(STUDY_APPROVED_JOB, expect.anything());
    });
  });
});
