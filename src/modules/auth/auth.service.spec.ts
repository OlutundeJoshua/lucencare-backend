import * as bcrypt from 'bcrypt';

import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';

import { AuditAction, ConsentStatus, OrgStatus, UserRole } from 'src/common/enums';
import {
  ADMIN_QUEUE,
  MAIL_QUEUE,
  ORG_VERIFICATION_JOB,
  SEND_OTP_JOB,
  SEND_PATIENT_ONBOARDING_WELCOME_JOB,
  SEND_RESET_PASSWORD_JOB,
} from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { ApplicationsService } from 'src/modules/applications/applications.service';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';

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
  let mockDataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let mockApplications: { getProfessionalByUser: jest.Mock; getBenefactorByUser: jest.Mock };
  let mockOrganizations: { findOne: jest.Mock };

  beforeEach(async () => {
    userRepo = makeMockRepo();
    mockRedis = makeMockRedis();
    mockMailQueue = makeMockQueue();
    mockAdminQueue = makeMockQueue();
    mockJwt = makeMockJwt();
    mockConfig = makeMockConfig();
    mockAudit = { log: jest.fn() };
    mockDataSource = { transaction: jest.fn(), getRepository: jest.fn() };
    mockApplications = {
      getProfessionalByUser: jest.fn().mockResolvedValue(null),
      getBenefactorByUser: jest.fn().mockResolvedValue(null),
    };
    mockOrganizations = { findOne: jest.fn() };

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
        { provide: ApplicationsService, useValue: mockApplications },
        { provide: OrganizationsService, useValue: mockOrganizations },
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
      // buildAuthPayload maps internal roles to the frontend's short-form role strings
      expect(result.user.role).toBe('ngo');
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
      // login resolves display name via dataSource.getRepository(Patient) for PATIENT users
      mockDataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

      const result = await service.login({
        email: user.email,
        password: 'correctpassword',
        role: 'patient',
      });

      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGIN }));
      expect(result.accessToken).toBeDefined();
    });

    it('throws 401 with generic message when email not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'any', role: 'patient' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 with generic message when password is wrong', async () => {
      const hash = await bcrypt.hash('correctpassword', 1);
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash: hash }));

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword', role: 'patient' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 403 when user is suspended', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash: hash, status: 'suspended' }));

      await expect(
        service.login({ email: 'test@example.com', password: 'password123', role: 'patient' }),
      ).rejects.toThrow(ForbiddenException);
    });

    // --- portal / role scoping ---

    // Every client role must resolve to its own internal UserRole. 'ngo' -> 'ngo_admin',
    // 'hmo' -> 'hmo_coordinator' and 'admin' -> 'platform_admin' are the non-identity
    // mappings that a hand-written check would get wrong.
    it.each([
      ['patient', UserRole.PATIENT],
      ['ngo', UserRole.NGO_ADMIN],
      ['hmo', UserRole.HMO_COORDINATOR],
      ['professional', UserRole.PROFESSIONAL],
      ['benefactor', UserRole.BENEFACTOR],
      ['admin', UserRole.PLATFORM_ADMIN],
      ['researcher', UserRole.RESEARCHER],
    ])('signs in a %s account from its own portal', async (clientRole, internalRole) => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'active', role: internalRole }),
      );
      mockDataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
        role: clientRole,
      });

      expect(result.accessToken).toBeDefined();
      expect(result.user.role).toBe(clientRole);
    });

    it('throws 401 when a patient signs in from the NGO portal', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'active', role: UserRole.PATIENT }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'password123', role: 'ngo' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('throws 401 when an NGO admin signs in from the HMO portal', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'active', role: UserRole.NGO_ADMIN }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'password123', role: 'hmo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Guards the ordering in login(): the role check must run BEFORE the suspended
    // check, otherwise a wrong-portal probe against a suspended account returns a
    // distinguishable 403 and confirms both that the account exists and that it is
    // suspended.
    it('throws 401, not 403, when a suspended account is probed from the wrong portal', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'suspended', role: UserRole.PATIENT }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'password123', role: 'ngo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('still throws 403 when a suspended account uses its correct portal', async () => {
      const hash = await bcrypt.hash('password123', 1);
      userRepo.findOne.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'suspended', role: UserRole.PATIENT }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'password123', role: 'patient' }),
      ).rejects.toThrow(ForbiddenException);
    });

    // BR-8: a wrong portal must be indistinguishable from a wrong password.
    it('returns an identical message for a wrong portal, a wrong password and an unknown email', async () => {
      const hash = await bcrypt.hash('password123', 1);
      const user = makeUser({ passwordHash: hash, status: 'active', role: UserRole.PATIENT });

      const messageFor = async (dto: { email: string; password: string; role: string }) => {
        try {
          await service.login(dto);
          throw new Error('expected login to reject');
        } catch (e) {
          return (e as Error).message;
        }
      };

      userRepo.findOne.mockResolvedValue(user);
      const wrongPortal = await messageFor({
        email: 'test@example.com',
        password: 'password123',
        role: 'ngo',
      });

      userRepo.findOne.mockResolvedValue(user);
      const wrongPassword = await messageFor({
        email: 'test@example.com',
        password: 'nope',
        role: 'patient',
      });

      userRepo.findOne.mockResolvedValue(null);
      const unknownEmail = await messageFor({
        email: 'nobody@example.com',
        password: 'password123',
        role: 'patient',
      });

      expect(wrongPortal).toBe('Invalid credentials');
      expect(wrongPassword).toBe(wrongPortal);
      expect(unknownEmail).toBe(wrongPortal);
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
      // refreshTokens resolves display name via dataSource.getRepository(Patient) for PATIENT users
      mockDataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

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

    // Without this a suspended user could rotate tokens forever, since status was
    // otherwise only ever checked at login.
    it('throws 403 for a suspended account', async () => {
      mockJwt.verify.mockReturnValue(validPayload);
      mockRedis.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(makeUser({ status: 'suspended' }));

      await expect(service.refreshTokens('old.refresh.token')).rejects.toThrow(ForbiddenException);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    // A pending user holds a valid session — they still need /auth/me and the
    // onboarding routes, both marked @AllowPending().
    it('still issues tokens for a pending account', async () => {
      mockJwt.verify.mockReturnValue(validPayload);
      mockRedis.get.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(makeUser({ status: 'pending', role: UserRole.NGO_ADMIN }));
      mockRedis.set.mockResolvedValue('OK');
      mockDataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

      const result = await service.refreshTokens('old.refresh.token');

      expect(result.accessToken).toBeDefined();
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

  // -------------------------
  // completePatientOnboarding
  // -------------------------
  describe('completePatientOnboarding', () => {
    const userId = 'USER01234567890123456789';
    const dto = {
      accountType: 'patient',
      dateOfBirth: '1990-01-01',
      biologicalSex: 'female',
      country: 'NG',
      conditions: 'Diabetes, Hypertension',
      primaryLanguage: 'en',
      termsConsent: true as const,
      ngoConsent: true,
      researchConsent: false,
    };

    it('updates the patient profile, upserts consent grants, and enqueues a welcome email after the transaction resolves', async () => {
      const patient = { id: 'PAT01234567890123456789', userId, name: 'Ada Okafor' };
      const patientRepo = makeMockRepo();
      patientRepo.findOne.mockResolvedValue(patient);

      const { manager, patientRepo: txPatientRepo, consentRepo } = makeTransactionManager();
      txPatientRepo.update.mockResolvedValue({ affected: 1 });
      consentRepo.findOne.mockResolvedValue(null);
      consentRepo.create.mockImplementation((data: unknown) => data);
      consentRepo.save.mockResolvedValue({});

      mockDataSource.getRepository.mockImplementation((entity: { name: string }) =>
        entity.name === 'Patient' ? patientRepo : makeMockRepo(),
      );
      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );
      userRepo.findOne.mockResolvedValue(makeUser({ id: userId, email: 'ada@example.com' }));

      await service.completePatientOnboarding(userId, dto as never);

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txPatientRepo.update).toHaveBeenCalledWith(
        { userId },
        expect.objectContaining({ isCaregiver: false, country: 'NG' }),
      );
      expect(mockMailQueue.add).toHaveBeenCalledWith(SEND_PATIENT_ONBOARDING_WELCOME_JOB, {
        to: 'ada@example.com',
        patientName: 'Ada Okafor',
      });
    });

    it('throws 409 when the patient profile does not exist', async () => {
      const patientRepo = makeMockRepo();
      patientRepo.findOne.mockResolvedValue(null);
      mockDataSource.getRepository.mockReturnValue(patientRepo);

      await expect(service.completePatientOnboarding(userId, dto as never)).rejects.toThrow(ConflictException);
      expect(mockMailQueue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue the welcome email when the transaction fails', async () => {
      const patient = { id: 'PAT01234567890123456789', userId, name: 'Ada Okafor' };
      const patientRepo = makeMockRepo();
      patientRepo.findOne.mockResolvedValue(patient);
      mockDataSource.getRepository.mockReturnValue(patientRepo);
      mockDataSource.transaction.mockRejectedValue(new Error('constraint violation'));
      userRepo.findOne.mockResolvedValue(makeUser({ id: userId }));

      await expect(service.completePatientOnboarding(userId, dto as never)).rejects.toThrow(
        'constraint violation',
      );
      expect(mockMailQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('signupLite', () => {
    function arrangeSignup() {
      const { manager, userRepo: txUserRepo, orgRepo, patientRepo } = makeTransactionManager();
      txUserRepo.findOne.mockResolvedValue(null);
      txUserRepo.create.mockImplementation((data: object) => ({ id: 'USER01234567890123456789', ...data }));
      txUserRepo.save.mockImplementation((u: object) => Promise.resolve(u));
      txUserRepo.update.mockResolvedValue({ affected: 1 });
      orgRepo.create.mockImplementation((data: object) => ({ id: 'ORG012345678901234567890', ...data }));
      orgRepo.save.mockImplementation((o: object) => Promise.resolve(o));
      patientRepo.create.mockImplementation((data: object) => data);
      patientRepo.save.mockResolvedValue({});

      mockDataSource.transaction.mockImplementation(async (fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager as never),
      );

      return { txUserRepo, orgRepo };
    }

    // users.name is the only place a professional's or benefactor's name is kept —
    // neither application table has a name column of its own.
    it.each([
      ['professional', UserRole.PROFESSIONAL],
      ['benefactor', UserRole.BENEFACTOR],
      ['ngo', UserRole.NGO_ADMIN],
    ])('persists the signup name on the user row for role %s', async (role, expectedRole) => {
      const { txUserRepo } = arrangeSignup();

      await service.signupLite({
        name: 'Dr Ada Okafor',
        email: 'ada@example.com',
        password: 'password123',
        role,
      });

      expect(txUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Dr Ada Okafor', role: expectedRole, status: 'pending' }),
      );
    });

    it('returns the name on the auth payload', async () => {
      arrangeSignup();

      const payload = await service.signupLite({
        name: 'Hope Health Initiative',
        email: 'admin@hopehealth.org',
        password: 'password123',
        role: 'ngo',
      });

      expect(payload.user.name).toBe('Hope Health Initiative');
      expect(payload.user.role).toBe('ngo');
    });
  });

  describe('completeNgoOnboarding', () => {
    const orgId = 'ORG012345678901234567890';
    const USER_ID = 'USER01234567890123456789';
    const dto = {
      orgName: 'Hope Health Initiative',
      registrationNumber: 'RC-123456',
      tin: '01234567-0001',
      scumlNumber: 'SCUML-998877',
      focusAreas: 'Maternal health, Diabetes',
      website: 'https://hopehealth.org',
      operatingRegions: 'Lagos, Ogun',
      headOfficeCountry: 'NG',
      programDescription: 'Community outreach and subsidised care.',
      termsConsent: true as const,
      dataProcessingConsent: true as const,
    };

    it('persists every submitted field, including tin, scumlNumber and consent timestamps', async () => {
      const orgRepo = makeMockRepo();
      orgRepo.findOne.mockResolvedValue({ id: orgId, contactEmail: 'admin@hopehealth.org' });
      orgRepo.update.mockResolvedValue({ affected: 1 });
      mockDataSource.getRepository.mockReturnValue(orgRepo);

      await service.completeNgoOnboarding(orgId, dto, USER_ID);

      expect(orgRepo.update).toHaveBeenCalledWith(
        { id: orgId },
        expect.objectContaining({
          name: dto.orgName,
          registrationNumber: dto.registrationNumber,
          tin: dto.tin,
          scumlNumber: dto.scumlNumber,
          focusAreas: dto.focusAreas,
          website: dto.website,
          operatingRegions: dto.operatingRegions,
          headOfficeCountry: dto.headOfficeCountry,
          programDescription: dto.programDescription,
          termsConsentAt: expect.any(Date),
          dataProcessingConsentAt: expect.any(Date),
        }),
      );
      expect(mockAdminQueue.add).toHaveBeenCalledWith(
        ORG_VERIFICATION_JOB,
        expect.objectContaining({ orgId, orgName: dto.orgName }),
      );
    });

    it('throws 409 when the organisation does not exist', async () => {
      const orgRepo = makeMockRepo();
      orgRepo.findOne.mockResolvedValue(null);
      mockDataSource.getRepository.mockReturnValue(orgRepo);

      await expect(service.completeNgoOnboarding(orgId, dto, USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(mockAdminQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    const userId = 'USER01234567890123456789';

    it('returns live status from the DB, not from the token', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ id: userId, role: UserRole.PROFESSIONAL, status: 'active', name: 'Dr Ada' }),
      );
      mockApplications.getProfessionalByUser.mockResolvedValue({ id: 'APP1', status: 'approved' });

      const me = await service.getMe(userId);

      expect(me).toEqual(
        expect.objectContaining({
          id: userId,
          name: 'Dr Ada',
          role: 'professional',
          status: 'active',
          application: { id: 'APP1', status: 'approved' },
        }),
      );
      expect(mockApplications.getBenefactorByUser).not.toHaveBeenCalled();
    });

    it('attaches the benefactor application for benefactor users', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ id: userId, role: UserRole.BENEFACTOR, status: 'pending' }));
      mockApplications.getBenefactorByUser.mockResolvedValue({ id: 'BEN1', status: 'pending' });

      const me = await service.getMe(userId);

      expect(me.application).toEqual({ id: 'BEN1', status: 'pending' });
      expect(me.organization).toBeUndefined();
    });

    it('attaches the organisation for NGO staff and maps the role to its client form', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ id: userId, role: UserRole.NGO_ADMIN, orgId: 'ORG1', status: 'pending' }),
      );
      mockOrganizations.findOne.mockResolvedValue({ id: 'ORG1', status: OrgStatus.PENDING_VERIFICATION });

      const me = await service.getMe(userId);

      expect(me.role).toBe('ngo');
      expect(me.orgId).toBe('ORG1');
      expect(me.organization).toEqual({ id: 'ORG1', status: OrgStatus.PENDING_VERIFICATION });
    });

    // A dangling orgId must not stop a user reading their own account state.
    it('omits the organisation when the org lookup fails', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ id: userId, role: UserRole.NGO_ADMIN, orgId: 'MISSING' }));
      mockOrganizations.findOne.mockRejectedValue(new Error('not found'));

      const me = await service.getMe(userId);

      expect(me.organization).toBeUndefined();
    });

    it('throws 401 when the user no longer exists', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getMe(userId)).rejects.toThrow(UnauthorizedException);
    });
  });
});
