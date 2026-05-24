// TODO: Implement — see docs/modules/audit.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from 'src/common/enums';

export interface AuditLogParams {
  actorId: string;
  action: AuditAction;
  resourceId: string;
  resourceType: string;
  metadata?: object;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(_params: AuditLogParams): Promise<void> {
    // INSERT only — no UPDATE or DELETE ever
    throw new Error('Not implemented');
  }
}
