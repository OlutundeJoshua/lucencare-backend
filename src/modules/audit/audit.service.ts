import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditAction } from 'src/common/enums';

import { AuditLog } from './entities/audit-log.entity';
import { AuditLogParams } from './interfaces/audit-log-params.interface';

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
