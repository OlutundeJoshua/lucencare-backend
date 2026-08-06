import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { OrgStatus } from 'src/common/enums';
import { User } from 'src/modules/auth/entities/user.entity';

import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { Organization } from './entities/organization.entity';
import { OrganizationWithContact } from './interfaces/organization-with-contact.interface';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // A-6: This method exists for AuthService to call inside a DataSource.transaction().
  // AuthService currently creates the org row inline (same pattern as Patient).
  // TODO (V2): wire AuthService.registerOrg() to call this method instead of building inline.
  async create(dto: CreateOrganizationDto, manager: EntityManager): Promise<Organization> {
    const repo = manager.getRepository(Organization);
    const org = repo.create({
      name: dto.name,
      type: dto.type,
      contactEmail: dto.contactEmail,
      status: OrgStatus.PENDING_VERIFICATION, // BR-1: all new orgs start pending
    });
    return repo.save(org);
  }

  // A-1: named findOne (not findById) to match AdminService's existing call pattern.
  // A-4: callerOrgId enforces org-scope + BR-3 (suspended check) at the service layer.
  // OrgScopeGuard does not perform this check in V1 — see org-scope.guard.ts TODO.
  async findOne(id: string, callerOrgId?: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id } });

    if (!org) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    if (callerOrgId !== undefined) {
      if (callerOrgId !== id) {
        throw new ForbiddenException('Access denied: cross-org attempt');
      }
      if (org.status === OrgStatus.SUSPENDED) {
        throw new ForbiddenException('Access denied: organization is suspended');
      }
    }

    return org;
  }

  async findAll(
    dto: ListOrganizationsDto,
  ): Promise<{ orgs: OrganizationWithContact[]; nextCursor?: string }> {
    const limit = dto.limit ?? 20;

    const qb = this.orgRepo
      .createQueryBuilder('org')
      .where('org.deleted_at IS NULL')
      .orderBy('org.id', 'ASC')
      .take(limit + 1);

    if (dto.status) {
      qb.andWhere('org.status = :status', { status: dto.status });
    }

    if (dto.type) {
      qb.andWhere('org.type = :type', { type: dto.type });
    }

    if (dto.cursor) {
      qb.andWhere('org.id > :cursor', { cursor: dto.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { orgs: await this.attachContactPerson(rows), nextCursor };
  }

  // The admin review screens display who submitted an application. That name
  // lives on users.name — organizations only stores contactEmail.
  private async attachContactPerson(orgs: Organization[]): Promise<OrganizationWithContact[]> {
    if (orgs.length === 0) return [];

    const staff = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.orgId', 'u.name'])
      .where('u.org_id IN (:...orgIds)', { orgIds: orgs.map((o) => o.id) })
      .getMany();

    const nameByOrgId = new Map(staff.map((u) => [u.orgId, u.name]));

    return orgs.map((org) => Object.assign(org, { contactPerson: nameByOrgId.get(org.id) }));
  }

  // A-2: positional args (id, status, adminId) to match AdminService's existing call:
  // orgsService.updateStatus(orgId, newStatus, adminUserId)
  // A-5: verifiedAt/verifiedBy are only set on ACTIVE transition (BR-2).
  async updateStatus(id: string, status: OrgStatus, adminId: string): Promise<Organization> {
    const org = await this.findOne(id);

    org.status = status;

    if (status === OrgStatus.ACTIVE) {
      org.verifiedAt = new Date();
      org.verifiedBy = adminId;
    }

    return this.orgRepo.save(org);
  }
}
