// TODO: Implement — see docs/modules/matching.md

import { Injectable } from '@nestjs/common';

import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class MatchingService {
  async findPrograms(_pagination: PaginationDto) {
    // Consent check is a SQL EXISTS subquery — never a JS filter
    // Excludes programs where expires_at <= NOW()
    throw new Error('Not implemented');
  }

  async findStudies(_pagination: PaginationDto) {
    // Consent check is a SQL EXISTS subquery — never a JS filter
    throw new Error('Not implemented');
  }

  async indexProgram(_programId: string) {
    // Called by AdminModule on program approval
    throw new Error('Not implemented');
  }

  async indexStudy(_studyId: string) {
    // Called by AdminModule on study approval
    throw new Error('Not implemented');
  }

  async getProgramMatchPreview(_programId: string) {
    // Returns { eligibleCount, tagSummary } — no patient IDs
    throw new Error('Not implemented');
  }

  async getEligiblePatientIds(_programId: string, _cursor?: string, _limit?: number) {
    // INTERNAL ONLY — called only by BullMQ fan-out worker, never via HTTP
    throw new Error('Not implemented');
  }
}
