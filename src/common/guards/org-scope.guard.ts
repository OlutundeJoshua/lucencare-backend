import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from 'src/common/enums';
import { ORG_SCOPED_KEY } from 'src/common/decorators/org-scoped.decorator';

@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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
