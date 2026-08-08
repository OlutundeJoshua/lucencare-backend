import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuditAction } from 'src/common/enums';
import { isNamedAuditResourceType } from 'src/common/constants/auditable-resources';
import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';
import { BenefactorApplication } from 'src/modules/applications/entities/benefactor-application.entity';
import { ProfessionalApplication } from 'src/modules/applications/entities/professional-application.entity';

import { ListAuditDto } from './dto/list-audit.dto';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogEntry } from './interfaces/audit-log-entry.interface';
import { AuditLogParams } from './interfaces/audit-log-params.interface';
import { AuditResource } from './interfaces/audit-resource.interface';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(ProfessionalApplication)
    private readonly professionalAppRepo: Repository<ProfessionalApplication>,
    @InjectRepository(BenefactorApplication)
    private readonly benefactorAppRepo: Repository<BenefactorApplication>,
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    const entry = this.auditRepo.create(params);
    await this.auditRepo.save(entry);
  }

  // Newest first. IDs are ULIDs, so descending id is descending time and the
  // cursor is a plain `id <` comparison.
  async findAll(dto: ListAuditDto): Promise<{ entries: AuditLogEntry[]; nextCursor?: string }> {
    const limit = dto.limit ?? 50;

    const qb = this.auditRepo
      .createQueryBuilder('a')
      .where('a.deleted_at IS NULL')
      .orderBy('a.id', 'DESC')
      .take(limit + 1);

    if (dto.action) {
      qb.andWhere('a.action = :action', { action: dto.action });
    }

    if (dto.resourceType) {
      qb.andWhere('a.resource_type = :resourceType', { resourceType: dto.resourceType });
    }

    if (dto.cursor) {
      qb.andWhere('a.id < :cursor', { cursor: dto.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    const entries = await this.attachActor(rows);
    await this.attachResource(entries);

    return { entries, nextCursor };
  }

  private async attachActor(rows: AuditLog[]): Promise<AuditLogEntry[]> {
    if (rows.length === 0) return [];

    const actors = await this.userRepo.find({
      where: { id: In([...new Set(rows.map((r) => r.actorId))]) },
      select: ['id', 'name', 'email'],
    });
    const byId = new Map(actors.map((u) => [u.id, u]));

    return rows.map((row) => {
      const actor = byId.get(row.actorId);
      return Object.assign(row, { actorName: actor?.name, actorEmail: actor?.email });
    });
  }

  /**
   * Resolves each row's subject to a display name, so the admin screen shows
   * "Hope Health Initiative" rather than a raw ULID.
   *
   * Only the resource types on the NAMED_AUDIT_RESOURCE_TYPES allowlist are resolved
   * — see src/common/constants/auditable-resources.ts for why patient, medication and
   * consent rows are deliberately left unnamed. Rows outside the allowlist, and rows
   * whose subject has since been deleted, keep `resourceName` undefined; the caller
   * falls back to `resourceId`.
   *
   * One batched query per resource type actually present in the page, mirroring
   * attachActor. Mutates the entries in place.
   */
  private async attachResource(entries: AuditLogEntry[]): Promise<void> {
    const idsByType = new Map<string, Set<string>>();

    for (const entry of entries) {
      if (!isNamedAuditResourceType(entry.resourceType)) continue;
      const ids = idsByType.get(entry.resourceType) ?? new Set<string>();
      ids.add(entry.resourceId);
      idsByType.set(entry.resourceType, ids);
    }

    if (idsByType.size === 0) return;

    // Resolve each present type concurrently — they are independent PK lookups.
    const resolved = new Map<string, AuditResource>();
    await Promise.all(
      [...idsByType].map(async ([resourceType, ids]) => {
        const found = await this.resolveByType(resourceType, [...ids]);
        for (const [id, resource] of found) {
          // Key by type as well as id: ids are unique across tables in practice,
          // but nothing guarantees it and a collision would mislabel a row.
          resolved.set(`${resourceType}:${id}`, resource);
        }
      }),
    );

    for (const entry of entries) {
      const resource = resolved.get(`${entry.resourceType}:${entry.resourceId}`);
      if (!resource) continue;
      // Normalise the DB's null to undefined so the key is omitted from the JSON
      // rather than serialised as null — a nameless subject reads the same as an
      // unresolvable one to the client, which falls back to resourceId either way.
      Object.assign(entry, {
        resourceName: resource.name ?? undefined,
        resourceSubtype: resource.subtype ?? undefined,
      });
    }
  }

  private async resolveByType(
    resourceType: string,
    ids: string[],
  ): Promise<Map<string, AuditResource>> {
    switch (resourceType) {
      case 'organization': {
        const orgs = await this.orgRepo.find({
          where: { id: In(ids) },
          select: ['id', 'name', 'type'],
        });
        // subtype carries ngo/hmo so the admin screen stops badging every org as NGO.
        return new Map(orgs.map((o) => [o.id, { name: o.name, subtype: o.type }]));
      }

      case 'program': {
        const programs = await this.programRepo.find({
          where: { id: In(ids) },
          select: ['id', 'title'],
        });
        return new Map(programs.map((p) => [p.id, { name: p.title }]));
      }

      case 'study': {
        const studies = await this.studyRepo.find({
          where: { id: In(ids) },
          select: ['id', 'title'],
        });
        return new Map(studies.map((s) => [s.id, { name: s.title }]));
      }

      case 'benefactor_application': {
        const apps = await this.benefactorAppRepo.find({
          where: { id: In(ids) },
          select: ['id', 'fullName'],
        });
        return new Map(apps.map((a) => [a.id, { name: a.fullName }]));
      }

      case 'professional_application': {
        // No name on the application itself — it lives on the applicant's user row.
        // Joined manually rather than via a relation decorator, per §6.2.
        const rows: Array<{ id: string; name?: string }> = await this.professionalAppRepo
          .createQueryBuilder('a')
          .leftJoin(User, 'u', 'u.id = a.user_id')
          .select(['a.id AS id', 'u.name AS name'])
          .where('a.id IN (:...ids)', { ids })
          .getRawMany();
        return new Map(rows.map((r) => [r.id, { name: r.name }]));
      }

      case 'User': {
        const users = await this.userRepo.find({
          where: { id: In(ids) },
          select: ['id', 'name'],
        });
        return new Map(users.map((u) => [u.id, { name: u.name }]));
      }

      default:
        // Unreachable while the allowlist and this switch agree; returning empty
        // rather than throwing keeps a newly-allowlisted type from 500ing the page.
        return new Map();
    }
  }
}
