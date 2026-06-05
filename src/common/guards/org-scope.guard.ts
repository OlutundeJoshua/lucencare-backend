import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from 'src/common/enums';
import { ORG_SCOPED_KEY } from 'src/common/decorators/org-scoped.decorator';

@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  // TODO (V2): check org.status !== OrgStatus.SUSPENDED for org-scoped routes.
  // To implement: inject OrganizationsService (make guard async), look up org by user.orgId,
  // throw ForbiddenException if suspended. All modules applying this guard must import
  // OrganizationsModule. Currently enforced in OrganizationsService.findOne() via callerOrgId
  // param for V1. See organizations.spec.md §9 for full context.
  canActivate(context: ExecutionContext): boolean {
    const isOrgScoped = this.reflector.getAllAndOverride<boolean>(ORG_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isOrgScoped) {
      return true;
    }

    const { user, params } = context.switchToHttp().getRequest();

    if (user?.role === UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException('Platform admins cannot access patient-scoped org routes');
    }

    if (params?.orgId && user?.orgId && params.orgId !== user.orgId) {
      throw new ForbiddenException('Access denied: cross-org attempt');
    }

    return true;
  }
}
