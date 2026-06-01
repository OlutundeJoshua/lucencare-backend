import * as bcrypt from 'bcrypt';

import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';

import { AuditAction, ConsentStatus, OrgStatus, UserRole } from 'src/common/enums';
import { ADMIN_QUEUE, MAIL_QUEUE, ORG_VERIFICATION_JOB, SEND_OTP_JOB, SEND_RESET_PASSWORD_JOB } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';

import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

// --- Mock factories ---

const makeUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: 'USER01234567890123456789',
    email: 'test@example.com',
    role: UserRole.PATIENT,
    status: 'active',
    passwordHash: '$2b$12$hashedpassword',
    orgId: undefined,
    ...overrides,
  });

const makeMockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const makeMockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  getdel: jest.fn(),
});

const makeMockQueue = () => ({ add: jest.fn() });

const makeMockJwt = () => ({
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn(),
});

const makeMockConfig = () => ({
  get: jest.fn((key: string, fallback?: unknown) => {
    const map: Record<string, unknown> = {
      'app.bcryptSaltRounds': 1, // cost 1 for speed in tests
      'app.nodeEnv': 'test',
      'jwt.accessTokenExpiresIn': '15m',
      'jwt.refreshTokenExpiresIn': '7d',
      'jwt.privateKey': 'private-key',
    };
    return map[key] ?? fallback;
  }),
});

// Transaction manager stub
const makeTransactionManager = (overrides: Record<string, ReturnType<typeof makeMockRepo>> = {}) => {
  const userRepo = overrides.User ?? makeMockRepo();
  const patientRepo = overrides.Patient ?? makeMockRepo();
  const orgRepo = overrides.Organization ?? makeMockRepo();
  const consentRepo = overrides.ConsentGrant ?? makeMockRepo();

  const manager = {
    getRepository: jest.fn((entity: { name: string }) => {
      if (entity.name === 'User') return userRepo;
      if (entity.name === 'Patient') return patientRepo;
      if (entity.name === 'Organization') return orgRepo;
      if (entity.name === 'ConsentGrant') return consentRepo;
      return makeMockRepo();
    }),
  };

  return { manager, userRepo, patientRepo, orgRepo, consentRepo };
};

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof makeMockRepo>;
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let mockMailQueue: ReturnType<typeof makeMockQueue>;
  let mockAdminQueue: ReturnType<typeof makeMockQueue>;
  let mockJwt: ReturnType<typeof makeMockJwt>;
  let mockConfig: ReturnType<typeof makeMockConfig>;
  let mockAudit: { log: jest.Mock };
  let mockDataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    userRepo = makeMockRepo();
    mockRedis = makeMockRedis();
    mockMailQueue = makeMockQueue();
    mockAdminQueue = makeMockQueue();
    mockJwt = makeMockJwt();
    mockConfig = makeMockConfig();
    mockAudit = { log: jest.fn() };
    mockDataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mockMailQueue },
        { provide: getQueueToken(ADMIN_QUEUE), useValue: mockAdminQueue },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // -------------------------
  // registerPatient
  // -------------------------
  describe('registerPatient', () => {
    const dto = {
      email: 'patient@example.com',
      password: 'password123',
      name: 'Ada Okafor',
      phone: '+2348000000001',
      conditionTags: ['hypertension'],
      consentPurposes: ['ngo_funding'],
    };

    it('creates user, patient, and consent_grant rows within a transaction', async () => {
      const { manager, userRepo: txUserRepo, patientRepo, consentRepo } = makeTransactionManager();

      const createdUser = makeUser({ id: 'USERID01234567890123456789', email: dto.email });
      const createdPatient = { id: 'PAT01234567890123456789' };
      const createdConsent = { id: 'CON01234567890123456789' };

      txUserRepo.findOne.mockResolvedValue(null);
      txUserRepo.create.mockReturnValue(createdUser);
      txUserRepo.save.mockResolvedValue(createdUser);
      patientRepo.findOne.mockResolvedValue(null);
      patientRepo.create.mockReturnValue(createdPatient);
      patientRepo.save.mockResolvedValue(createdPatient);
      consentRepo.create.mockReturnValue(createdConsent);
      consentRepo.save.mockResolvedValue(createdConsent);

      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      const result = await service.registerPatient(dto as never);

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txUserRepo.save).toHaveBeenCalledTimes(1);
      expect(patientRepo.save).toHaveBeenCalledTimes(1);
      expect(consentRepo.save).toHaveBeenCalledTimes(1);
      expect(consentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: ConsentStatus.ACTIVE, purpose: 'ngo_funding' }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN }),
      );
      expect(result).toMatchObject({ user: { email: dto.email } });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
    });

    it('throws 409 when email is already registered', async () => {
      const { manager, userRepo: txUserRepo } = makeTransactionManager();
      txUserRepo.findOne.mockResolvedValue(makeUser());
      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      await expect(service.registerPatient(dto as never)).rejects.toThrow(ConflictException);
    });

    it('throws 409 when phone is already registered', async () => {
      const { manager, userRepo: txUserRepo, patientRepo } = makeTransactionManager();
      txUserRepo.findOne.mockResolvedValue(null);
      patientRepo.findOne.mockResolvedValueOnce({ id: 'existing-patient' });
      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      await expect(service.registerPatient(dto as never)).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------
  // registerOrg
  // -------------------------
  describe('registerOrg', () => {
    const dto = {
      email: 'admin@ngo.org',
      password: 'password123',
      orgName: 'Helping Hands NGO',
      orgType: 'ngo',
      contactEmail: 'contact@ngo.org',
      role: UserRole.NGO_ADMIN,
    };

    it('creates org and user rows and enqueues org_verification job', async () => {
      const { manager, userRepo: txUserRepo, orgRepo } = makeTransactionManager();
      const createdOrg = { id: 'ORG01234567890123456789', name: dto.orgName, contactEmail: dto.contactEmail };
      const createdUser = makeUser({ email: dto.email, role: UserRole.NGO_ADMIN, status: 'pending' });

      txUserRepo.findOne.mockResolvedValue(null);
      orgRepo.create.mockReturnValue(createdOrg);
      orgRepo.save.mockResolvedValue(createdOrg);
      txUserRepo.create.mockReturnValue(createdUser);
      txUserRepo.save.mockResolvedValue(createdUser);

      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      const result = await service.registerOrg(dto as never);

      expect(orgRepo.save).toHaveBeenCalledTimes(1);
      expect(orgRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrgStatus.PENDING_VERIFICATION }),
      );
      expect(mockAdminQueue.add).toHaveBeenCalledWith(
        ORG_VERIFICATION_JOB,
        expect.objectContaining({ orgId: createdOrg.id }),
      );
      expect(result.user.role).toBe(UserRole.NGO_ADMIN);
    });

    it('throws 409 when email is already registered', async () => {
      const { manager, userRepo: txUserRepo } = makeTransactionManager();
      txUserRepo.findOne.mockResolvedValue(makeUser());
      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      await expect(service.registerOrg(dto as never)).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------
  // registerResearcher
  // -------------------------
  describe('registerResearcher', () => {
    const dto = {
      email: 'researcher@university.edu',
      password: 'password123',
      institutionName: 'Lagos University',
      otpCode: '123456',
    };

    beforeEach(() => {
      process.env.ALLOWED_INSTITUTION_DOMAINS = 'university.edu,hospital.ng';
    });

    afterEach(() => {
      delete process.env.ALLOWED_INSTITUTION_DOMAINS;
    });

    it('creates a researcher user after OTP verification', async () => {
      mockRedis.get.mockResolvedValue('123456');
      mockRedis.del.mockResolvedValue(1);
      userRepo.findOne.mockResolvedValue(null);
      const createdUser = makeUser({ email: dto.email, role: UserRole.RESEARCHER });
      userRepo.create.mockReturnValue(createdUser);
      userRepo.save.mockResolvedValue(createdUser);

      const result = await service.registerResearcher(dto as never);

      expect(mockRedis.get).toHaveBeenCalledWith(`otp:${dto.email}`);
      expect(mockRedis.del).toHaveBeenCalledWith(`otp:${dto.email}`);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGIN }));
      expect(result.user.role).toBe(UserRole.RESEARCHER);
    });

    it('throws 400 when email domain is not on the allowlist', async () => {
      await expect(
        service.registerResearcher({ ...dto, email: 'user@gmail.com' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 401 when OTP is not found in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.registerResearcher(dto as never)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when OTP code does not match', async () => {
      mockRedis.get.mockResolvedValue('999999');

      await expect(service.registerResearcher(dto as never)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 409 when email is already registered', async () => {
      mockRedis.get.mockResolvedValue('123456');
      userRepo.findOne.mockResolvedValue(makeUser());

      await expect(service.registerResearcher(dto as never)).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------
  // requestOtp
  // -------------------------
  describe('requestOtp', () => {
    it('stores OTP in Redis and enqueues send_otp mail job', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockMailQueue.add.mockResolvedValue({});

      await service.requestOtp({ email: 'researcher@hospital.ng' });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'otp:researcher@hospital.ng',
        expect.stringMatching(/^\d{6}$/),
        'EX',
        600,
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith(
        SEND_OTP_JOB,
        expect.objectContaining({ to: 'researcher@hospital.ng', expiresInMinutes: 10 }),
      );
    });
  });

  // -------------------------
  // login
  // -------------------------
  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      const hash = await bcrypt.hash('correctpassword', 1);
      const user = makeUser({ passwordHash: hash, status: 'active' });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'correctpassword' });

      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGIN }));
      expect(result.accessToken).toBeDefined();
    });

    it('throws 401 with generic message when email not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password: 'any' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 with generic message when password is wrong', async () => {
      const hash = await bcrypt.hash('correctpassword', 1);
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash: hash }));

      await expect(service.login({ email: 'test@example.com', password: 'wrongpassword' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 403 when user is suspended', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash: hash, status: 'suspended' }));

      await expect(service.login({ email: 'test@example.com', password: 'password123' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------
  // refreshTokens
  // -------------------------
  describe('refreshTokens', () => {
    const NOW_SECONDS = Math.floor(Date.now() / 1000);
    const validPayload = { sub: 'USER01234567890123456789', jti: 'JTI0123456789', exp: NOW_SECONDS + 3600 };

    it('issues new tokens and revokes old jti', async () => {
      mockJwt.verify.mockReturnValue(validPayload);
      mockRedis.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(makeUser());
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.refreshTokens('old.refresh.token');

      expect(mockRedis.set).toHaveBeenCalledWith(
        `refresh:revoked:${validPayload.jti}`,
        '1',
        'EX',
        expect.any(Number),
      );
      expect(result.accessToken).toBeDefined();
    });

    it('throws 401 when the refresh JWT is invalid', async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('invalid signature'); });

      await expect(service.refreshTokens('bad.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when the jti is in the revocation set', async () => {
      mockJwt.verify.mockReturnValue(validPayload);
      mockRedis.get.mockResolvedValue('1');

      await expect(service.refreshTokens('old.refresh.token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // -------------------------
  // logout
  // -------------------------
  describe('logout', () => {
    it('writes the jti to Redis revocation set when refresh token is present', async () => {
      // Use jsonwebtoken.sign to produce a properly formatted JWT that jwt.decode() can parse
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { sign } = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const rawToken = sign({ jti: 'SOME_JTI', sub: 'USERID01234567890123456789' }, 'test-secret', {
        expiresIn: '1h',
      });
      mockRedis.set.mockResolvedValue('OK');

      await service.logout(rawToken);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'refresh:revoked:SOME_JTI',
        '1',
        'EX',
        expect.any(Number),
      );
    });

    it('does not throw when refresh token is absent', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
    });

    it('does not throw when refresh token is malformed', async () => {
      await expect(service.logout('not.a.valid.jwt')).resolves.toBeUndefined();
    });
  });

  // -------------------------
  // forgotPassword
  // -------------------------
  describe('forgotPassword', () => {
    it('stores a reset token in Redis and enqueues send_reset_password job when email exists', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      mockRedis.set.mockResolvedValue('OK');
      mockMailQueue.add.mockResolvedValue({});

      await service.forgotPassword({ email: user.email });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^reset:/),
        user.id,
        'EX',
        3600,
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith(
        SEND_RESET_PASSWORD_JOB,
        expect.objectContaining({ to: user.email }),
      );
    });

    it('returns silently when email is not registered (no error leak)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.forgotPassword({ email: 'nobody@example.com' })).resolves.toBeUndefined();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockMailQueue.add).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // resetPassword
  // -------------------------
  describe('resetPassword', () => {
    it('consumes the reset token and updates the password hash', async () => {
      mockRedis.getdel.mockResolvedValue('USER01234567890123456789');
      userRepo.update.mockResolvedValue({ affected: 1 });

      await service.resetPassword({ token: 'valid-token', password: 'newpassword' });

      expect(mockRedis.getdel).toHaveBeenCalledWith('reset:valid-token');
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'USER01234567890123456789' },
        { passwordHash: expect.any(String) },
      );
    });

    it('throws 401 when the reset token is expired or already used', async () => {
      mockRedis.getdel.mockResolvedValue(null);

      await expect(service.resetPassword({ token: 'stale-token', password: 'newpassword' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
