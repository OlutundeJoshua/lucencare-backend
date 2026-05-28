// @nestjs/passport is mocked via jest.config.ts moduleNameMapper (CLAUDE.md §10.6).
// Remove that mapping once the real package is installed.

import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const mockUser = { sub: 'user-ulid-01', role: 'patient' };

describe('JwtAuthGuard', () => {
  let cls: { set: jest.Mock; get: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    cls = { set: jest.fn(), get: jest.fn() };
    guard = new JwtAuthGuard(cls as any);
  });

  it('returns the user and sets cls userId on successful auth', () => {
    const result = guard.handleRequest(null as any, mockUser as any);
    expect(result).toBe(mockUser);
    expect(cls.set).toHaveBeenCalledWith('userId', mockUser.sub);
  });

  it('throws UnauthorizedException when user is null', () => {
    expect(() => guard.handleRequest(null as any, null as any)).toThrow(UnauthorizedException);
  });

  it('rethrows the provided error when err is set', () => {
    const err = new UnauthorizedException('Token expired');
    expect(() => guard.handleRequest(err, null as any)).toThrow(err);
  });

  it('does not call cls.set when authentication fails', () => {
    try {
      guard.handleRequest(null as any, null as any);
    } catch {}
    expect(cls.set).not.toHaveBeenCalled();
  });
});
