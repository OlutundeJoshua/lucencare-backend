import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProgramStatus } from 'src/common/enums';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';

import { PlatformStats } from './interfaces/platform-stats.interface';

/**
 * How long a computed total is reused before the database is asked again.
 *
 * These numbers sit on an unauthenticated page, so request volume is unbounded
 * and uncorrelated with sign-ups. Without this, every visitor costs two
 * COUNT(*) scans. Five minutes is far fresher than the figures need to be.
 */
const STATS_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class PublicService {
  /**
   * Deliberately in-process rather than Redis. The only thing a shared cache
   * would buy is that N instances miss once each per TTL instead of one — two
   * queries every five minutes per instance is already nothing, and it keeps
   * this module from opening a second Redis connection of its own.
   */
  private cached?: { at: number; stats: PlatformStats };

  constructor(
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
    @InjectRepository(Program)
    private readonly programRepository: Repository<Program>,
  ) {}

  async getStats(now = Date.now()): Promise<PlatformStats> {
    if (this.cached && now - this.cached.at < STATS_TTL_MS) {
      return this.cached.stats;
    }

    // count() honours the @DeleteDateColumn on BaseEntity, so soft-deleted rows
    // are already excluded from both totals.
    //
    // If RLS is ever enabled on `programs` (CLAUDE.md §6.5 describes it as
    // org-scoped but no migration creates the policy yet), this call runs with
    // no app.org_id set and will start returning 0. The policy will need to
    // admit approved programmes unconditionally, or this count must move behind
    // a SECURITY DEFINER function.
    const [patients, ngoPrograms] = await Promise.all([
      this.patientRepository.count(),
      this.programRepository.count({ where: { status: ProgramStatus.APPROVED } }),
    ]);

    const stats: PlatformStats = { patients, ngoPrograms };
    this.cached = { at: now, stats };
    return stats;
  }
}
