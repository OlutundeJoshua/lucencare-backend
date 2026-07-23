import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditAction } from 'src/common/enums';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

const mockAuditRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
});

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: ReturnType<typeof mockAuditRepo>;

  beforeEach(async () => {
    auditRepo = mockAuditRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: getRepositoryToken(AuditLog), useValue: auditRepo }],
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
});
