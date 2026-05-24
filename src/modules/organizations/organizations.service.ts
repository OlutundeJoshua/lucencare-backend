// TODO: Implement — see docs/modules/organizations.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organization } from './entities/organization.entity';
import { OrgStatus } from 'src/common/enums';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
  ) {}

  async create(_data: Partial<Organization>) {
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async updateStatus(_id: string, _status: OrgStatus, _adminId: string) {
    throw new Error('Not implemented');
  }

  async listPrograms(_orgId: string) {
    throw new Error('Not implemented');
  }
}
