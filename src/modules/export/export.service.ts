// TODO: Implement — see docs/modules/export.md

import { Injectable } from '@nestjs/common';

import { CreateTokenDto } from './dto/create-token.dto';

@Injectable()
export class ExportService {
  async createToken(_dto: CreateTokenDto) {
    // Sign JWT, store jti in Redis with TTL — no DB entity
    throw new Error('Not implemented');
  }

  async validateAndConsumeToken(_token: string) {
    // redis.getdel(jti) — atomic single-use enforcement
    // Returns null → UnauthorizedException
    throw new Error('Not implemented');
  }

  async buildPdf(_patientId: string, _fields: string[]) {
    // Always writes audit_log entry before returning
    throw new Error('Not implemented');
  }
}
