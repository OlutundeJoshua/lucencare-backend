import { Entity, Column, Index } from 'typeorm';

import { BaseEntity } from 'src/common/entities/base.entity';
import { ProgramType, ProgramStatus } from 'src/common/enums';

@Entity('programs')
@Index(['orgId'])
@Index(['status'])
@Index(['expiresAt'])
export class Program extends BaseEntity {
  @Column({ name: 'org_id', type: 'char', length: 26 })
  orgId: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'type', type: 'varchar', enum: ProgramType })
  type: ProgramType;

  /**
   * The REVIEW state — where the programme sits in platform admin approval. This is
   * not the lifecycle state an NGO sees (Active / Closing / Full / Paused), which is
   * derived at read time from pausedAt, slot counts and expiresAt. Keeping the two
   * apart means a derived label can never go stale against the stored one.
   */
  @Column({
    name: 'status',
    type: 'varchar',
    enum: ProgramStatus,
    default: ProgramStatus.PENDING_REVIEW,
  })
  status: ProgramStatus;

  @Column({ name: 'eligibility_criteria', type: 'jsonb' })
  eligibilityCriteria: object[];

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  // ── Programme detail ───────────────────────────────────────────────────────
  // Nullable so existing rows survive the migration; the create DTO requires the
  // ones an NGO must state up front.

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  /** Short summary of what the programme covers, e.g. "Diabetes · Hypertension". */
  @Column({ name: 'focus', type: 'text', nullable: true })
  focus?: string;

  @Column({ name: 'donor', type: 'text', nullable: true })
  donor?: string;

  @Column({ name: 'coordinator', type: 'text', nullable: true })
  coordinator?: string;

  // ── Funding and capacity ───────────────────────────────────────────────────
  // Money in minor units (kobo) as bigint-backed numeric: floats cannot represent
  // currency exactly, and a budget that drifts by rounding is worse than none.

  @Column({ name: 'budget_total', type: 'bigint', nullable: true, transformer: {
    to: (v?: number) => v ?? null,
    from: (v: string | null) => (v === null ? undefined : Number(v)),
  } })
  budgetTotal?: number;

  @Column({ name: 'budget_disbursed', type: 'bigint', default: 0, transformer: {
    to: (v?: number) => v ?? 0,
    from: (v: string | null) => (v === null ? 0 : Number(v)),
  } })
  budgetDisbursed: number;

  @Column({ name: 'slots_total', type: 'integer', nullable: true })
  slotsTotal?: number;

  /** Maintained by the platform as patients are selected — never set by the NGO. */
  @Column({ name: 'slots_filled', type: 'integer', default: 0 })
  slotsFilled: number;

  /**
   * Set when an NGO pauses intake. The only lifecycle state that is stored rather
   * than derived, because nothing else in the data implies it.
   *
   * Typed `Date | null` rather than optional: resuming must write an explicit NULL,
   * and TypeORM's update() reads `undefined` as "leave unchanged".
   */
  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt?: Date | null;
}
