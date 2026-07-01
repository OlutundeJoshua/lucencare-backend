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

  async log(params: AuditLogParams): Promise<void> {
    const entry = this.auditRepo.create(params);
    await this.auditRepo.save(entry);
  }
}
