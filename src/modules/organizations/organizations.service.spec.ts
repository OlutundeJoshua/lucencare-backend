import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

import { OrgStatus, OrgType } from 'src/common/enums';

import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { Organization } from './entities/organization.entity';
import { OrganizationsService } from './organizations.service';

const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZAB';
const ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  const org = new Organization();
  org.id = ORG_ID;
  org.name = 'Test Org';
  org.type = OrgType.NGO;
  org.status = OrgStatus.ACTIVE;
  org.contactEmail = 'org@test.com';
  return Object.assign(org, overrides);
}

const mockQueryBuilder = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(Organization), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    jest.clearAllMocks();
    // Reset chainable mock after clearAllMocks
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('saves an org via the transaction manager with PENDING_VERIFICATION status', async () => {
      const org = makeOrg({ status: OrgStatus.PENDING_VERIFICATION });
      const managerRepo = { create: jest.fn().mockReturnValue(org), save: jest.fn().mockResolvedValue(org) };
      const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) } as unknown as EntityManager;

      const result = await service.create(
        { name: 'Test Org', type: OrgType.NGO, contactEmail: 'org@test.com' },
        manager,
      );

      expect(managerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrgStatus.PENDING_VERIFICATION }),
      );
      expect(managerRepo.save).toHaveBeenCalledWith(org);
      expect(result.status).toBe(OrgStatus.PENDING_VERIFICATION);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne — internal caller (no callerOrgId)
  // ---------------------------------------------------------------------------

  describe('findOne (no callerOrgId — internal)', () => {
    it('returns the org when found', async () => {
      const org = makeOrg();
      mockRepo.findOne.mockResolvedValue(org);

      const result = await service.findOne(ORG_ID);

      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: ORG_ID } });
      expect(result).toBe(org);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne — HTTP caller (callerOrgId provided)
  // ---------------------------------------------------------------------------

  describe('findOne (with callerOrgId — HTTP caller)', () => {
    it('throws ForbiddenException when callerOrgId does not match id', async () => {
      const org = makeOrg();
      mockRepo.findOne.mockResolvedValue(org);

      await expect(service.findOne(ORG_ID, 'DIFFERENT_ORG_ID_12345678')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when org is suspended', async () => {
      const org = makeOrg({ status: OrgStatus.SUSPENDED });
      mockRepo.findOne.mockResolvedValue(org);

      await expect(service.findOne(ORG_ID, ORG_ID)).rejects.toThrow(ForbiddenException);
    });

    it('returns org when callerOrgId matches and org is active', async () => {
      const org = makeOrg({ status: OrgStatus.ACTIVE });
      mockRepo.findOne.mockResolvedValue(org);

      const result = await service.findOne(ORG_ID, ORG_ID);

      expect(result).toBe(org);
    });

    it('returns org when callerOrgId matches and org is pending_verification', async () => {
      const org = makeOrg({ status: OrgStatus.PENDING_VERIFICATION });
      mockRepo.findOne.mockResolvedValue(org);

      const result = await service.findOne(ORG_ID, ORG_ID);

      expect(result).toBe(org);
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns paginated orgs with nextCursor when more rows exist', async () => {
      const orgs = Array.from({ length: 21 }, (_, i) => makeOrg({ id: `ORG_${i.toString().padStart(22, '0')}` }));
      mockQueryBuilder.getMany.mockResolvedValue(orgs);

      const result = await service.findAll({ limit: 20 } as ListOrganizationsDto);

      expect(result.orgs).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });

    it('returns orgs with no nextCursor on last page', async () => {
      const orgs = [makeOrg()];
      mockQueryBuilder.getMany.mockResolvedValue(orgs);

      const result = await service.findAll({ limit: 20 } as ListOrganizationsDto);

      expect(result.orgs).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('applies status filter when provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findAll({ status: OrgStatus.PENDING_VERIFICATION } as ListOrganizationsDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'org.status = :status',
        { status: OrgStatus.PENDING_VERIFICATION },
      );
    });

    it('applies cursor filter when provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findAll({ cursor: ORG_ID } as ListOrganizationsDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'org.id > :cursor',
        { cursor: ORG_ID },
      );
    });

    it('returns empty array when no orgs match', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.findAll({} as ListOrganizationsDto);

      expect(result.orgs).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('throws NotFoundException when org does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.updateStatus(ORG_ID, OrgStatus.ACTIVE, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('sets verifiedAt and verifiedBy when transitioning to ACTIVE', async () => {
      const org = makeOrg({ status: OrgStatus.PENDING_VERIFICATION, verifiedAt: undefined, verifiedBy: undefined });
      mockRepo.findOne.mockResolvedValue(org);
      mockRepo.save.mockResolvedValue({ ...org, status: OrgStatus.ACTIVE, verifiedAt: new Date(), verifiedBy: ADMIN_ID });

      await service.updateStatus(ORG_ID, OrgStatus.ACTIVE, ADMIN_ID);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrgStatus.ACTIVE, verifiedAt: expect.any(Date), verifiedBy: ADMIN_ID }),
      );
    });

    it('does not set verifiedAt or verifiedBy when status is REJECTED', async () => {
      const org = makeOrg({ status: OrgStatus.PENDING_VERIFICATION, verifiedAt: undefined, verifiedBy: undefined });
      mockRepo.findOne.mockResolvedValue(org);
      mockRepo.save.mockImplementation((o: Organization) => Promise.resolve(o));

      await service.updateStatus(ORG_ID, OrgStatus.REJECTED, ADMIN_ID);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ verifiedAt: undefined, verifiedBy: undefined }),
      );
    });

    it('does not set verifiedAt or verifiedBy when status is SUSPENDED', async () => {
      const org = makeOrg({ status: OrgStatus.ACTIVE, verifiedAt: undefined, verifiedBy: undefined });
      mockRepo.findOne.mockResolvedValue(org);
      mockRepo.save.mockImplementation((o: Organization) => Promise.resolve(o));

      await service.updateStatus(ORG_ID, OrgStatus.SUSPENDED, ADMIN_ID);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ verifiedAt: undefined, verifiedBy: undefined }),
      );
    });

    it('saves and returns the updated org', async () => {
      const org = makeOrg({ status: OrgStatus.PENDING_VERIFICATION });
      const updated = makeOrg({ status: OrgStatus.ACTIVE, verifiedAt: new Date(), verifiedBy: ADMIN_ID });
      mockRepo.findOne.mockResolvedValue(org);
      mockRepo.save.mockResolvedValue(updated);

      const result = await service.updateStatus(ORG_ID, OrgStatus.ACTIVE, ADMIN_ID);

      expect(result).toBe(updated);
    });
  });
});
