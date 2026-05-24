// TODO: Implement — see docs/modules/admin.md

import { Injectable } from '@nestjs/common';

import { AdminApproveDto } from './dto/admin-approve.dto';

@Injectable()
export class AdminService {
  async reviewProgram(_programId: string, _dto: AdminApproveDto) {
    // On approval: updateStatus, trigger indexProgram, enqueue notification, write audit
    throw new Error('Not implemented');
  }

  async reviewStudy(_studyId: string, _dto: AdminApproveDto) {
    // On approval: updateStatus, trigger indexStudy, enqueue notification, write audit
    throw new Error('Not implemented');
  }

  async reviewOrganization(_orgId: string, _dto: AdminApproveDto) {
    // On approval: updateStatus, notify org staff, write audit
    throw new Error('Not implemented');
  }
}
