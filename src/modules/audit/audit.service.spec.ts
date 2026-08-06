import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditAction, OrgType } from 'src/common/enums';

import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';
import { BenefactorApplication } from 'src/modules/applications/entities/benefactor-application.entity';
import { ProfessionalApplication } from 'src/modules/applications/entities/professional-application.entity';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

const mockQueryBuilder = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

// The professional-application resolver joins to users, so it needs its own builder.
const mockJoinQueryBuilder = {
  leftJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
};

const mockAuditRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
});

const mockFindRepo = () => ({ find: jest.fn().mockResolvedValue([]) });

const mockProfessionalAppRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => mockJoinQueryBuilder),
});

/** An audit row as the query builder would return it. */
function row(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: '01HZZZZZZZZZZZZZZZZZZZZZA1',
    actorId: '01HZZZZZZZZZZZZZZZZZZZZZAA',
    action: AuditAction.ADMIN_APPROVE,
    resourceId: '01HZZZZZZZZZZZZZZZZZZZZZB1',
    resourceType: 'organization',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  } as AuditLog;
}

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: ReturnType<typeof mockAuditRepo>;
  let userRepo: ReturnType<typeof mockFindRepo>;
  let orgRepo: ReturnType<typeof mockFindRepo>;
  let programRepo: ReturnType<typeof mockFindRepo>;
  let studyRepo: ReturnType<typeof mockFindRepo>;
  let professionalAppRepo: ReturnType<typeof mockProfessionalAppRepo>;
  let benefactorAppRepo: ReturnType<typeof mockFindRepo>;

  beforeEach(async () => {
    auditRepo = mockAuditRepo();
    userRepo = mockFindRepo();
    orgRepo = mockFindRepo();
    programRepo = mockFindRepo();
    studyRepo = mockFindRepo();
    professionalAppRepo = mockProfessionalAppRepo();
    benefactorAppRepo = mockFindRepo();

    jest.clearAllMocks();
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.andWhere.mockReturnThis();
    mockQueryBuilder.orderBy.mockReturnThis();
    mockQueryBuilder.take.mockReturnThis();
    mockQueryBuilder.getMany.mockResolvedValue([]);
    mockJoinQueryBuilder.leftJoin.mockReturnThis();
    mockJoinQueryBuilder.select.mockReturnThis();
    mockJoinQueryBuilder.where.mockReturnThis();
    mockJoinQueryBuilder.getRawMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: getRepositoryToken(Program), useValue: programRepo },
        { provide: getRepositoryToken(Study), useValue: studyRepo },
        { provide: getRepositoryToken(ProfessionalApplication), useValue: professionalAppRepo },
        { provide: getRepositoryToken(BenefactorApplication), useValue: benefactorAppRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('creates and saves an audit log entry from the given params', async () => {
      const params = {
        actorId: '01HZZZZZZZZZZZZZZZZZZZZZAA',
        action: AuditAction.REVOKE_CONSENT,
        resourceId: '01HZZZZZZZZZZZZZZZZZZZZZAB',
        resourceType: 'ConsentGrant',
        metadata: { purpose: 'ngo_funding' },
      };
      const entry = { id: '01HZZZZZZZZZZZZZZZZZZZZZAC', ...params };
      auditRepo.create.mockReturnValue(entry);
      auditRepo.save.mockResolvedValue(entry);

      await service.log(params);

      expect(auditRepo.create).toHaveBeenCalledWith(params);
      expect(auditRepo.save).toHaveBeenCalledWith(entry);
    });
  });

  describe('findAll — resource name resolution', () => {
    it('resolves an organisation name and its ngo/hmo subtype', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'ORG_NGO', resourceType: 'organization' }),
        row({ id: '01HZZZZZZZZZZZZZZZZZZZZZA2', resourceId: 'ORG_HMO', resourceType: 'organization' }),
      ]);
      orgRepo.find.mockResolvedValue([
        { id: 'ORG_NGO', name: 'Hope Health Initiative', type: OrgType.NGO },
        { id: 'ORG_HMO', name: 'Apex Health HMO', type: OrgType.HMO },
      ]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBe('Hope Health Initiative');
      expect(entries[0].resourceSubtype).toBe('ngo');
      // The bug this closes: the admin screen used to badge every org as NGO.
      expect(entries[1].resourceName).toBe('Apex Health HMO');
      expect(entries[1].resourceSubtype).toBe('hmo');
    });

    it('resolves a professional application to the applicant name via the users join', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'APP1', resourceType: 'professional_application' }),
      ]);
      mockJoinQueryBuilder.getRawMany.mockResolvedValue([{ id: 'APP1', name: 'Dr Ada Obi' }]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBe('Dr Ada Obi');
      expect(mockJoinQueryBuilder.where).toHaveBeenCalledWith('a.id IN (:...ids)', {
        ids: ['APP1'],
      });
    });

    it('resolves a benefactor application from its own fullName column', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'BEN1', resourceType: 'benefactor_application' }),
      ]);
      benefactorAppRepo.find.mockResolvedValue([{ id: 'BEN1', fullName: 'Taiwo Balogun' }]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBe('Taiwo Balogun');
    });

    it('resolves programs and studies from their title', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'PRG1', resourceType: 'program' }),
        row({ id: '01HZZZZZZZZZZZZZZZZZZZZZA2', resourceId: 'STD1', resourceType: 'study' }),
      ]);
      programRepo.find.mockResolvedValue([{ id: 'PRG1', title: 'Diabetes Support Fund' }]);
      studyRepo.find.mockResolvedValue([{ id: 'STD1', title: 'Hypertension Cohort 2026' }]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBe('Diabetes Support Fund');
      expect(entries[1].resourceName).toBe('Hypertension Cohort 2026');
    });

    it('queries only the resource types present in the page', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'ORG1', resourceType: 'organization' }),
      ]);

      await service.findAll({});

      expect(orgRepo.find).toHaveBeenCalledTimes(1);
      expect(programRepo.find).not.toHaveBeenCalled();
      expect(studyRepo.find).not.toHaveBeenCalled();
      expect(benefactorAppRepo.find).not.toHaveBeenCalled();
      expect(professionalAppRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('batches one query per type regardless of row count', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'ORG1', resourceType: 'organization' }),
        row({ id: '01HZZZZZZZZZZZZZZZZZZZZZA2', resourceId: 'ORG2', resourceType: 'organization' }),
        row({ id: '01HZZZZZZZZZZZZZZZZZZZZZA3', resourceId: 'ORG3', resourceType: 'organization' }),
      ]);

      await service.findAll({});

      expect(orgRepo.find).toHaveBeenCalledTimes(1);
    });

    it('leaves resourceName undefined when the subject no longer exists', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'GONE', resourceType: 'organization' }),
      ]);
      orgRepo.find.mockResolvedValue([]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBeUndefined();
      // The row itself survives — an audit trail must not drop entries.
      expect(entries).toHaveLength(1);
      expect(entries[0].resourceId).toBe('GONE');
    });

    it('still attaches the actor alongside the resource', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([row({ actorId: 'ADMIN1' })]);
      userRepo.find.mockResolvedValue([
        { id: 'ADMIN1', name: 'Admin Taiwo', email: 'admin@lucencare.test' },
      ]);
      orgRepo.find.mockResolvedValue([
        { id: '01HZZZZZZZZZZZZZZZZZZZZZB1', name: 'Hope Health', type: OrgType.NGO },
      ]);

      const { entries } = await service.findAll({});

      expect(entries[0].actorName).toBe('Admin Taiwo');
      expect(entries[0].resourceName).toBe('Hope Health');
    });
  });

  // This is the privacy boundary from src/common/constants/auditable-resources.ts.
  // These tests must fail if someone adds a patient-bearing type to the allowlist.
  describe('findAll — privacy allowlist', () => {
    it.each([['patient'], ['medication'], ['ConsentGrant']])(
      'never resolves a name for a %s row',
      async (resourceType) => {
        mockQueryBuilder.getMany.mockResolvedValue([
          row({ resourceId: 'SENSITIVE1', resourceType, action: AuditAction.EXPORT }),
        ]);

        const { entries } = await service.findAll({});

        expect(entries[0].resourceName).toBeUndefined();
        expect(entries[0].resourceSubtype).toBeUndefined();
        // The resourceId survives, so the action stays traceable without naming who.
        expect(entries[0].resourceId).toBe('SENSITIVE1');
      },
    );

    it('issues no resource lookup at all for a page of only patient rows', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'PAT1', resourceType: 'patient', action: AuditAction.EXPORT }),
        row({
          id: '01HZZZZZZZZZZZZZZZZZZZZZA2',
          resourceId: 'MED1',
          resourceType: 'medication',
          action: AuditAction.MEDICATION_REFILL_REQUESTED,
        }),
      ]);

      await service.findAll({});

      expect(orgRepo.find).not.toHaveBeenCalled();
      expect(programRepo.find).not.toHaveBeenCalled();
      expect(studyRepo.find).not.toHaveBeenCalled();
      expect(benefactorAppRepo.find).not.toHaveBeenCalled();
      expect(professionalAppRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('resolves the allowlisted rows on a mixed page and skips the rest', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        row({ resourceId: 'ORG1', resourceType: 'organization' }),
        row({
          id: '01HZZZZZZZZZZZZZZZZZZZZZA2',
          resourceId: 'PAT1',
          resourceType: 'patient',
          action: AuditAction.EXPORT,
        }),
      ]);
      orgRepo.find.mockResolvedValue([{ id: 'ORG1', name: 'Hope Health', type: OrgType.NGO }]);

      const { entries } = await service.findAll({});

      expect(entries[0].resourceName).toBe('Hope Health');
      expect(entries[1].resourceName).toBeUndefined();
    });
  });

  describe('findAll — pagination', () => {
    it('returns a cursor and trims the extra row when more pages exist', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        row({ id: `01HZZZZZZZZZZZZZZZZZZZZZA${i}`, resourceType: 'patient' }),
      );
      mockQueryBuilder.getMany.mockResolvedValue(rows);

      const { entries, nextCursor } = await service.findAll({ limit: 2 });

      expect(entries).toHaveLength(2);
      expect(nextCursor).toBe('01HZZZZZZZZZZZZZZZZZZZZZA1');
    });

    it('returns no cursor on the last page', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([row({ resourceType: 'patient' })]);

      const { nextCursor } = await service.findAll({ limit: 2 });

      expect(nextCursor).toBeUndefined();
    });

    it('returns an empty page without touching any resource repository', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const { entries, nextCursor } = await service.findAll({});

      expect(entries).toEqual([]);
      expect(nextCursor).toBeUndefined();
      expect(userRepo.find).not.toHaveBeenCalled();
      expect(orgRepo.find).not.toHaveBeenCalled();
    });
  });
});
