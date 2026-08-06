// @nestjs/passport is mocked via src/__mocks__/@nestjs/passport.ts (CLAUDE.md §10.6).
// Its AuthGuard stub returns true from canActivate, so these tests drive the
// ExecutionContext directly and exercise only our own status logic on top.

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ALLOW_PENDING_KEY } from 'src/common/decorators/allow-pending.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const USER_ID = 'user-ulid-01';
const mockUser = { sub: USER_ID, role: 'patient' };

function makeContext(user: unknown = mockUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let cls: { set: jest.Mock; get: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    cls = { set: jest.fn(), get: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    userRepo = { findOne: jest.fn() };
    guard = new JwtAuthGuard(cls as never, reflector as never, userRepo as never);
  });

  // -------------------------
  // handleRequest
  // -------------------------
  describe('handleRequest', () => {
    it('returns the user and sets cls userId on successful auth', () => {
      const result = guard.handleRequest(null as never, mockUser as never);
      expect(result).toBe(mockUser);
      expect(cls.set).toHaveBeenCalledWith('userId', mockUser.sub);
    });

    it('throws UnauthorizedException when user is null', () => {
      expect(() => guard.handleRequest(null as never, null as never)).toThrow(UnauthorizedException);
    });

    it('rethrows the provided error when err is set', () => {
      const err = new UnauthorizedException('Token expired');
      expect(() => guard.handleRequest(err, null as never)).toThrow(err);
    });

    it('does not call cls.set when authentication fails', () => {
      try {
        guard.handleRequest(null as never, null as never);
      } catch {
        /* expected */
      }
      expect(cls.set).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // account status
  // -------------------------
  describe('account status check', () => {
    it('admits an active account', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID, status: 'active' });

      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: ['id', 'status'],
      });
    });

    // The bug this closes: a pending NGO admin or HMO coordinator reaching every
    // endpoint their role allowed, including patient lookup and care events.
    it('throws 403 for a pending account', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID, status: 'pending' });

      await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(makeContext())).rejects.toThrow('Account pending verification');
    });

    it('throws 403 for a suspended account', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID, status: 'suspended' });

      await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(makeContext())).rejects.toThrow('Account suspended');
    });

    it('throws 403 for any unrecognised status rather than failing open', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID, status: 'something-new' });

      await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('throws 401 when the user row no longer exists', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
    });

    // Status is read live so an approval takes effect on the next request rather
    // than when the 15-minute access token expires.
    it('reads status per request rather than trusting the token', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: USER_ID, status: 'pending' });
      await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);

      userRepo.findOne.mockResolvedValueOnce({ id: USER_ID, status: 'active' });
      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });
  });

  // -------------------------
  // @AllowPending opt-out
  // -------------------------
  describe('@AllowPending()', () => {
    it('skips the status check entirely when the route opts out', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('reads the marker from handler and class metadata', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID, status: 'active' });

      await guard.canActivate(makeContext());

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ALLOW_PENDING_KEY, [
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });
});
