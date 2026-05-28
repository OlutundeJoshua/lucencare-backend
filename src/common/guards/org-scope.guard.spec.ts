import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { OrgScopeGuard } from './org-scope.guard';
import { UserRole } from 'src/common/enums';
import { ORG_SCOPED_KEY } from 'src/common/decorators/org-scoped.decorator';

function makeContext(
  isOrgScoped: boolean | undefined,
  user: { role: UserRole; orgId?: string } | undefined,
  params: Record<string, string> = {},
): ExecutionContext {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isOrgScoped),
  } as unknown as Reflector;

  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;

  return ctx;
}

describe('OrgScopeGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  });

  it('passes when @OrgScoped() metadata is not set', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const guard = new OrgScopeGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.PATIENT }, params: {} }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when platform_admin accesses org-scoped route', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const guard = new OrgScopeGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: UserRole.PLATFORM_ADMIN, orgId: undefined }, params: {} }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when orgId in params does not match JWT orgId', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const guard = new OrgScopeGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.NGO_ADMIN, orgId: 'org-a' },
          params: { orgId: 'org-b' },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('passes when orgId in params matches JWT orgId', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const guard = new OrgScopeGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.NGO_ADMIN, orgId: 'org-a' },
          params: { orgId: 'org-a' },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when no orgId param is present (route does not expose :orgId)', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const guard = new OrgScopeGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.NGO_ADMIN, orgId: 'org-a' },
          params: {},
        }),
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
