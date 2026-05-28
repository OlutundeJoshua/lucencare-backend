import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RoleGuard } from './role.guard';
import { UserRole } from 'src/common/enums';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';

function makeContext(role: UserRole | undefined, requiredRoles?: UserRole[]): ExecutionContext {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) } as unknown as Reflector;
  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
  return ctx;
}

describe('RoleGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  });

  it('passes when no @Roles() metadata is set', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when @Roles() is empty array', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when user role matches required role', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([UserRole.NGO_ADMIN]);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.NGO_ADMIN } }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when user role is in a list of allowed roles', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([UserRole.NGO_ADMIN, UserRole.PLATFORM_ADMIN]);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.PLATFORM_ADMIN } }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user role is not in allowed roles', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([UserRole.NGO_ADMIN]);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.PATIENT } }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is undefined', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([UserRole.NGO_ADMIN]);
    const guard = new RoleGuard(reflector);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: undefined }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
